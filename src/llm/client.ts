import OpenAI from "openai";
import { getConfig } from "../config/store.js";
import type { AppConfig } from "../config/store.js";
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
  thinking?: { type: "enabled" | "disabled" };
  reasoning_effort?: string;
};
type Delta = ChatChunk["choices"][number]["delta"];
type DeltaToolCall = NonNullable<Delta["tool_calls"]>[number];

interface StreamingCompletions {
  create(
    params: StreamingParams,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<ChatChunk>>;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

interface StreamState {
  toolCalls: Map<number, ToolCallAccumulator>;
}

function buildClient(): OpenAI {
  const config = getConfig();
  if (!config.apiKey) {
    throw new Error("API Key 未配置，请先运行 /setup 进行配置");
  }
  return buildClientWithConfig(config);
}

/**
 * 按 provider 构造 OpenAI 客户端：
 * - deepseek：标准 Bearer 认证，baseUrl 直接使用。
 * - codebuddy：同时发送 X-API-Key 与 Authorization: Bearer 两个头。
 */
export function buildClientWithConfig(config: AppConfig): OpenAI {
  if (config.provider === "codebuddy") {
    return new OpenAI({
      baseURL: normalizeCodebuddyBaseUrl(config.baseUrl),
      apiKey: config.apiKey,
      defaultHeaders: { "X-API-Key": config.apiKey },
      dangerouslyAllowBrowser: false,
    });
  }
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: false,
  });
}

/**
 * CodeBuddy 的 chat 端点是 `<endpoint>/v2/chat/completions`；缺少 /v2 前缀时，
 * 网关会把请求 302 重定向到错误地址，导致流式响应为空（无回复内容）。
 * 这里对旧配置（baseUrl 未带 /v2）做归一化，保证端点前缀完整。
 */
export function normalizeCodebuddyBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v2") ? trimmed : `${trimmed}/v2`;
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
  yield { type: "done", toolCalls: buildCompletedToolCalls(state) };
}

async function createChatStream(
  options: StreamChatOptions,
): Promise<AsyncIterable<ChatChunk>> {
  const client = buildClient();
  const completions = client.chat.completions as unknown as StreamingCompletions;
  return completions.create(
    buildStreamingParams(options),
    options.signal ? { signal: options.signal } : undefined,
  );
}

function buildStreamingParams(options: StreamChatOptions): StreamingParams {
  const config = getConfig();
  return buildStreamingParamsWithConfig(options, config);
}

export function buildStreamingParamsWithConfig(
  options: StreamChatOptions,
  config: AppConfig,
): StreamingParams {
  return {
    model: config.model,
    messages: toOpenAIMessages(options.messages),
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: config.thinking ? "enabled" : "disabled" },
    ...(config.thinking
      ? { reasoning_effort: config.reasoningEffort }
      : {}),
    ...(options.tools && options.tools.length > 0 ? { tools: options.tools } : {}),
  };
}

function createStreamState(): StreamState {
  return { toolCalls: new Map() };
}

function consumeChunk(chunk: ChatChunk, state: StreamState): StreamEvent[] {
  const events = usageEvents(chunk);
  const delta = chunk.choices[0]?.delta;
  if (!delta) return events;

  return [
    ...events,
    ...reasoningEvents(delta),
    ...textEvents(delta),
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
): StreamEvent[] {
  if (!delta.content) return [];
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

function buildCompletedToolCalls(state: StreamState): ToolCall[] | null {
  return state.toolCalls.size > 0 ? buildToolCalls(state) : null;
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
