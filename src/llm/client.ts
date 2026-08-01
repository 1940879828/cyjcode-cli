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
  // 注册工具: 告诉模型有你这个agent目前哪些工具可以调用
  tools?: Record<string, unknown>[];
  /**
   * 配合 AbortController 使用主动取消一个异步操作
   * AbortController 是遥控器，AbortSignal 是接收器。controller.abort() 一按，所有持有同一个 signal 的异步操作都会被取消。
   */
  signal?: AbortSignal;
}

// 新建一个http客户端 每次发请求都new一个 放一下配置字符串
function buildClient(): OpenAI {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error("API Key 未配置，请先运行 /setup 进行配置");
  }
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: false,
  });
}


/**
 * 数据适配转换
 * 把ChatMessage转换为OpenAI的ChatCompletionMessageParam 
 * 
 */
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
 * 适配器：适配OpenAI返回值
 * 流式调用 LLM，通过 AsyncGenerator 逐块产出 StreamEvent。
 * 每次向大模型发送请求都要调用一次
 */
export async function* streamChat(
  options: StreamChatOptions
): AsyncGenerator<StreamEvent> {
  // 拿配置
  const config = getConfig();
  // 拿客户端
  const client = buildClient();
  // 准备消息
  const openaiMessages = toOpenAIMessages(options.messages);

  try {
    /**
     * 发请求
     * return Stream<ChatCompletionChunk> 异步可迭代对象
     *  实现了 AsyncIterable 接口，所以可以用 for await...of 来逐块消费。
     */
    // DeepSeek 特有参数 thinking 不在 OpenAI 类型定义中
    // 使用 any 绕过类型检查，运行时完全兼容
    // 注意：不能解耦 create 方法，否则 this 上下文丢失导致 _client 为 undefined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> = await (client.chat.completions as any).create({
      model: config.model,
      messages: openaiMessages,
      stream: true,
      ...(config.thinking
        ? { thinking: { type: "enabled" as const } }
        : {}),
      ...(options.tools && options.tools.length > 0
        ? { tools: options.tools }
        : {}),
    });

    /**
     * 跨 chunk 拼接工具调用
     * 工具调用是分块返回的，需要在下一个 chunk 中才能确定调用完成。
     */
    const toolCallAccumulator: Map<number, ToolCallAccumulator> = new Map();
    let hasContent = false;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // 处理 DeepSeek 思考过程增量
      // reasoning_content 是 DeepSeek 的 chain-of-thought，只在最终回复前出现
      if ((delta as Record<string, unknown>).reasoning_content) {
        yield {
          type: "reasoning_delta",
          content: (delta as Record<string, unknown>).reasoning_content as string,
        };
      }

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
          deltas: delta.tool_calls.map((tc: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall) => ({
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
