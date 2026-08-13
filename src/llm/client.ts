import OpenAI from "openai";
import { getConfig } from "../config/store.js";
import type {
  ChatMessage,
  TokenUsage,
  ToolCall,
  ToolCallDelta,
  StreamEvent,
} from "./types.js";

export interface StreamChatOptions {
  messages: ChatMessage[];
  tools?: Record<string, unknown>[];
  signal?: AbortSignal;
}

type ChatChunk = OpenAI.Chat.Completions.ChatCompletionChunk;
type StreamingParams = Omit<OpenAI.Chat.ChatCompletionCreateParamsStreaming, "tools"> & {
  tools?: Record<string, unknown>[];
  thinking?: { type: "enabled" };
  reasoning_effort?: string;
};
type Delta = ChatChunk["choices"][number]["delta"];
type DeltaToolCall = NonNullable<Delta["tool_calls"]>[number];

interface StreamingCompletions {
  create(params: StreamingParams): Promise<AsyncIterable<ChatChunk>>;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

interface StreamState {
  toolCalls: Map<number, ToolCallAccumulator>;
  hasContent: boolean;
}

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

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map(toOpenAIMessage);
}

function toOpenAIMessage(msg: ChatMessage): OpenAI.Chat.ChatCompletionMessageParam {
  const base: Record<string, unknown> = { role: msg.role, content: msg.content };
  if (msg.name) base.name = msg.name;
  if (msg.tool_call_id) base.tool_call_id = msg.tool_call_id;
  if (msg.tool_calls) base.tool_calls = msg.tool_calls.map(toOpenAIToolCall);
  return base as unknown as OpenAI.Chat.ChatCompletionMessageParam;
}

function toOpenAIToolCall(toolCall: ToolCall): Record<string, unknown> {
  return {
    id: toolCall.id,
    type: "function" as const,
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  };
}

export async function* streamChat(
  options: StreamChatOptions
): AsyncGenerator<StreamEvent> {
  try {
    const stream = await createChatStream(options);
    yield* consumeChatStream(stream);
  } catch (error) {
    yield {
      type: "error",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function* consumeChatStream(stream: AsyncIterable<ChatChunk>): AsyncGenerator<StreamEvent> {
  const state = createStreamState();
  for await (const chunk of stream) {
    for (const event of consumeChunk(chunk, state)) {
      yield event;
    }
  }
  yield { type: "done", message: buildFinalMessage(state) };
}

async function createChatStream(
  options: StreamChatOptions,
): Promise<AsyncIterable<ChatChunk>> {
  const client = buildClient();
  const completions = client.chat.completions as unknown as StreamingCompletions;
  return completions.create(buildStreamingParams(options));
}

function buildStreamingParams(options: StreamChatOptions): StreamingParams {
  const config = getConfig();
  return {
    model: config.model,
    messages: toOpenAIMessages(options.messages),
    stream: true,
    stream_options: { include_usage: true },
    ...(config.thinking
      ? { thinking: { type: "enabled" as const }, reasoning_effort: config.reasoningEffort }
      : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

function createStreamState(): StreamState {
  return { toolCalls: new Map(), hasContent: false };
}

function consumeChunk(chunk: ChatChunk, state: StreamState): StreamEvent[] {
  const events = usageEvents(chunk);
  const delta = chunk.choices[0]?.delta;
  if (!delta) return events;

  return [
    ...events,
    ...reasoningEvents(delta),
    ...textEvents(delta, state),
    ...toolCallEvents(delta, state),
  ];
}

function usageEvents(chunk: ChatChunk): StreamEvent[] {
  return chunk.usage ? [{ type: "usage", usage: toTokenUsage(chunk.usage) }] : [];
}

function reasoningEvents(delta: ChatChunk["choices"][number]["delta"]): StreamEvent[] {
  const reasoning = (delta as { reasoning_content?: unknown }).reasoning_content;
  return typeof reasoning === "string"
    ? [{ type: "reasoning_delta", content: reasoning }]
    : [];
}

function textEvents(
  delta: ChatChunk["choices"][number]["delta"],
  state: StreamState,
): StreamEvent[] {
  if (!delta.content) return [];
  state.hasContent = true;
  return [{ type: "text_delta", content: delta.content }];
}

function toolCallEvents(
  delta: ChatChunk["choices"][number]["delta"],
  state: StreamState,
): StreamEvent[] {
  if (!delta.tool_calls) return [];
  delta.tool_calls.forEach((toolCall) => accumulateToolCall(state, toolCall));
  return [{ type: "tool_call_delta", deltas: delta.tool_calls.map(toToolCallDelta) }];
}

function accumulateToolCall(
  state: StreamState,
  toolCall: DeltaToolCall,
): void {
  const current = state.toolCalls.get(toolCall.index) ?? {
    id: "",
    name: "",
    arguments: "",
  };

  state.toolCalls.set(toolCall.index, {
    id: toolCall.id ?? current.id,
    name: current.name + (toolCall.function?.name ?? ""),
    arguments: current.arguments + (toolCall.function?.arguments ?? ""),
  });
}

function toToolCallDelta(
  toolCall: DeltaToolCall,
): ToolCallDelta {
  return {
    index: toolCall.index,
    id: toolCall.id ?? undefined,
    type: toolCall.type as "function" | undefined,
    function: toolCall.function
      ? {
          name: toolCall.function.name ?? undefined,
          arguments: toolCall.function.arguments ?? undefined,
        }
      : undefined,
  };
}

function buildFinalMessage(state: StreamState): ChatMessage {
  const finalMessage: ChatMessage = { role: "assistant", content: null };
  if (state.hasContent && state.toolCalls.size === 0) finalMessage.content = "";
  if (state.toolCalls.size > 0) finalMessage.tool_calls = buildToolCalls(state);
  return finalMessage;
}

function buildToolCalls(state: StreamState): ToolCall[] {
  return Array.from(state.toolCalls.entries())
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => ({
      id: toolCall.id,
      type: "function" as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    }));
}

function toTokenUsage(usage: OpenAI.Completions.CompletionUsage): TokenUsage {
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}
