import OpenAI from "openai";
import { getConfig } from "../config/store.js";
import type {
  ChatMessage,
  ToolCall,
  ToolCallDelta,
  StreamEvent,
} from "./types.js";

// 接口请求参数
export interface StreamChatOptions {
  // 上下文历史 每次调用都必须把整个对话历史传回去
  messages: ChatMessage[];
  tools?: Record<string, unknown>[];
  signal?: AbortSignal;
}

function buildClient(): OpenAI {
  const config = getConfig();
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: false,
  });
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    const base: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.name) base.name = msg.name;
    if (msg.tool_call_id) base.tool_call_id = msg.tool_call_id;
    if (msg.tool_calls) {
      base.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }
    return base as unknown as OpenAI.Chat.ChatCompletionMessageParam;
  });
}

/**
 * 流式调用 LLM，通过 AsyncGenerator 逐块产出 StreamEvent。
 */
export async function* streamChat(
  options: StreamChatOptions
): AsyncGenerator<StreamEvent> {
  const config = getConfig();
  const client = buildClient();

  const openaiMessages = toOpenAIMessages(options.messages);

  try {
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      stream: true,
      ...(options.tools && options.tools.length > 0
        ? {
            tools: options.tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
          }
        : {}),
    });

    const toolCallAccumulator: Map<number, ToolCallAccumulator> = new Map();
    let hasContent = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // 处理文本增量
      if (delta.content) {
        hasContent = true;
        yield { type: "text_delta", content: delta.content };
      }

      // 处理工具调用增量
      if (delta.tool_calls) {
        const deltas: ToolCallDelta[] = [];
        for (const tc of delta.tool_calls) {
          let acc = toolCallAccumulator.get(tc.index);
          if (!acc) {
            acc = { id: "", name: "", arguments: "" };
            toolCallAccumulator.set(tc.index, acc);
          }

          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }

        yield {
          type: "tool_call_delta",
          deltas: delta.tool_calls.map((tc) => ({
            index: tc.index,
            id: tc.id ?? undefined,
            type: tc.type as "function" | undefined,
            function: tc.function
              ? {
                  name: tc.function.name ?? undefined,
                  arguments: tc.function.arguments ?? undefined,
                }
              : undefined,
          })),
        };
      }
    }

    // 构造最终消息
    const finalMessage: ChatMessage = {
      role: "assistant",
      content: null,
    };

    if (hasContent && toolCallAccumulator.size === 0) {
      // 纯文本回复
      finalMessage.content = ""; // content 由外部累积
    }

    if (toolCallAccumulator.size > 0) {
      finalMessage.tool_calls = Array.from(toolCallAccumulator.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, acc]) => ({
          id: acc.id,
          type: "function" as const,
          function: {
            name: acc.name,
            arguments: acc.arguments,
          },
        }));
    }

    yield { type: "done", message: finalMessage };
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}
