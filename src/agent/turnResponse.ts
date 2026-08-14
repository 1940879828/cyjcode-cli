import type { StreamEvent, TokenUsage, ToolCall } from "../llm/types.js";
import { log } from "../utils/logger.js";
import type { AgentEvent } from "./types.js";

const MAX_REASONING_LOG_CHARS = 500;

export interface TurnResponse {
  fullText: string;
  reasoningLength: number;
  reasoningDeltaCount: number;
  toolCalls: ToolCall[] | null;
  usage: TokenUsage | null;
}

export interface StreamConsumeContext {
  sessionId: string;
  turn: number;
  response: TurnResponse;
}

export function createTurnResponse(): TurnResponse {
  return { fullText: "", reasoningLength: 0, reasoningDeltaCount: 0, toolCalls: null, usage: null };
}

export function consumeStreamEvent(
  event: StreamEvent,
  context: StreamConsumeContext,
): AgentEvent | null {
  switch (event.type) {
    case "reasoning_delta":
      return consumeReasoningDelta(context.response, event.content, context);
    case "text_delta": return consumeTextDelta(context.response, event.content);
    case "usage": return consumeUsage(context.response, event.usage);
    case "done":
      context.response.toolCalls = event.toolCalls;
      return null;
    case "tool_call_delta": return { type: "tool_call_delta", deltas: event.deltas };
    case "error": throw event.error;
  }
}

export function logLlmResponse(
  sessionId: string,
  turn: number,
  response: TurnResponse,
): void {
  log("llm.response", {
    sessionId,
    turn,
    hasToolCalls: !!response.toolCalls,
    toolCallCount: response.toolCalls?.length ?? 0,
    reasoningLength: response.reasoningLength,
    reasoningDeltaCount: response.reasoningDeltaCount,
    responseLength: response.fullText.length,
    promptTokens: response.usage?.promptTokens,
    completionTokens: response.usage?.completionTokens,
    totalTokens: response.usage?.totalTokens,
  });
}

function consumeReasoningDelta(
  response: TurnResponse,
  content: string,
  context: Pick<StreamConsumeContext, "sessionId" | "turn">,
): AgentEvent {
  response.reasoningLength += content.length;
  response.reasoningDeltaCount += 1;
  log("llm.reasoning_delta", {
    sessionId: context.sessionId,
    turn: context.turn,
    length: content.length,
    preview: truncateForLog(content, MAX_REASONING_LOG_CHARS),
  });
  return { type: "reasoning_delta", content };
}

function consumeTextDelta(response: TurnResponse, content: string): AgentEvent {
  response.fullText += content;
  return { type: "text_delta", content };
}

function consumeUsage(response: TurnResponse, usage: TokenUsage): AgentEvent {
  response.usage = usage;
  return { type: "usage", usage };
}

function truncateForLog(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
