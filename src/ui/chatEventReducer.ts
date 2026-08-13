import type { Dispatch, SetStateAction } from "react";
import type { AgentEvent } from "../agent/types.js";
import {
  appendAssistantPart,
  appendAssistantTextDelta,
  createAssistantTurn,
  finalizeAssistantTurn,
  hasAssistantTurnContent,
} from "./assistantTurn.js";
import type { AssistantTurn } from "./assistantTurn.js";
import type { ContextUsageState } from "./contextUsage.js";
import { formatToolDisplay, formatToolErrorDisplay } from "./toolDisplay.js";
import type { ChatEntry, TextChatEntry, ToolCallEntry } from "./chatTypes.js";

export interface ChatEventSession {
  reasoning: string;
  assistantTurn: AssistantTurn | null;
  pendingToolCalls: Map<string, ToolCallEntry>;
}

export interface ChatEventHandlers {
  append: (entry: ChatEntry) => void;
  makeEntry: (
    role: TextChatEntry["role"],
    content: string,
    extra?: Partial<Pick<TextChatEntry, "toolCall" | "toolResult">>,
  ) => TextChatEntry;
  nextId: () => string;
  setStreamingReasoning: (value: string) => void;
  setStreamingAssistantTurn: (value: AssistantTurn | null) => void;
  setContextUsage: Dispatch<SetStateAction<ContextUsageState>>;
}

export function createChatEventSession(): ChatEventSession {
  return {
    reasoning: "",
    assistantTurn: null,
    pendingToolCalls: new Map(),
  };
}

export function consumeChatEvent(
  event: AgentEvent,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  const handler = AGENT_EVENT_HANDLERS[event.type];
  handler(event as never, session, handlers);
}

const AGENT_EVENT_HANDLERS: {
  [Type in AgentEvent["type"]]: (
    event: Extract<AgentEvent, { type: Type }>,
    session: ChatEventSession,
    handlers: ChatEventHandlers,
  ) => void;
} = {
  reasoning_delta: (event, session, handlers) => appendReasoning(event.content, session, handlers),
  text_delta: (event, session, handlers) => appendAssistantText(event.content, session, handlers),
  tool_call: rememberToolCall,
  tool_result: appendToolResultSummary,
  usage: (event, _session, handlers) => handlers.setContextUsage({ status: "ready", usage: event.usage }),
  done: (event, session, handlers) => finalizeTurn(event.fullText, session, handlers),
  error: (event, session, handlers) => appendError(event.error, session, handlers),
  turn_start: ignoreAgentEvent,
  turn_end: ignoreAgentEvent,
  user_message: ignoreAgentEvent,
};

function ignoreAgentEvent(): void {}

function appendReasoning(
  content: string,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  session.reasoning += content;
  handlers.setStreamingReasoning(session.reasoning);
}

function appendAssistantText(
  content: string,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  session.assistantTurn = appendAssistantTextDelta(
    session.assistantTurn ?? createAssistantTurn(handlers.nextId(), Date.now()),
    content,
  );
  handlers.setStreamingAssistantTurn(session.assistantTurn);
}

function rememberToolCall(
  event: Extract<AgentEvent, { type: "tool_call" }>,
  session: ChatEventSession,
): void {
  session.pendingToolCalls.set(event.callId, {
    callId: event.callId,
    name: event.name,
    arguments: event.arguments,
  });
}

function appendToolResultSummary(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  const toolCall = takeToolCall(event, session);
  const content = formatToolResultSummary(event, toolCall);
  session.assistantTurn = appendAssistantPart(
    session.assistantTurn ?? createAssistantTurn(handlers.nextId(), Date.now()),
    handlers.nextId(),
    { id: handlers.nextId(), kind: event.result.success ? "tool" : "error", content },
  );
  handlers.setStreamingAssistantTurn(session.assistantTurn);
}

function takeToolCall(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  session: ChatEventSession,
): ToolCallEntry {
  const toolCall = session.pendingToolCalls.get(event.callId) ?? {
    callId: event.callId,
    name: event.name,
    arguments: {},
  };
  session.pendingToolCalls.delete(event.callId);
  return toolCall;
}

function formatToolResultSummary(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  toolCall: ToolCallEntry,
): string {
  const context = { name: event.name, arguments: toolCall.arguments, result: event.result };
  return event.result.success
    ? formatToolDisplay(context)
    : formatToolErrorDisplay(context);
}

function finalizeTurn(
  fullText: string,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  handlers.setContextUsage((current) =>
    current.status === "loading" ? { status: "error" } : current,
  );
  handlers.setStreamingReasoning("");
  if (session.reasoning) handlers.append(handlers.makeEntry("thinking", session.reasoning));

  session.assistantTurn = finalizeAssistantTurn(
    session.assistantTurn ?? createAssistantTurn(handlers.nextId(), Date.now()),
    handlers.nextId(),
    fullText || "（无回复内容）",
  );
  handlers.append(session.assistantTurn);
  session.assistantTurn = null;
  handlers.setStreamingAssistantTurn(null);
}

function appendError(
  error: string,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  if (!session.assistantTurn || !hasAssistantTurnContent(session.assistantTurn)) {
    appendStandaloneError(error, handlers);
    return;
  }

  appendTurnError(error, session, handlers);
}

function appendStandaloneError(error: string, handlers: ChatEventHandlers): void {
  handlers.append(handlers.makeEntry("error", `错误: ${error}`));
  markContextUsageError(handlers);
}

function appendTurnError(
  error: string,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  if (!session.assistantTurn) return;
  session.assistantTurn = appendAssistantPart(session.assistantTurn, handlers.nextId(), createErrorPart(error, handlers));
  handlers.append(session.assistantTurn);
  session.assistantTurn = null;
  handlers.setStreamingAssistantTurn(null);
  markContextUsageError(handlers);
}

function createErrorPart(
  error: string,
  handlers: ChatEventHandlers,
): { id: string; kind: "error"; content: string } {
  return { id: handlers.nextId(), kind: "error", content: `错误: ${error}` };
}

function markContextUsageError(handlers: ChatEventHandlers): void {
  markLoadingContextUsageError(handlers.setContextUsage);
}

export function markLoadingContextUsageError(
  setContextUsage: Dispatch<SetStateAction<ContextUsageState>>,
): void {
  setContextUsage((current) =>
    current.status === "loading" ? { status: "error" } : current,
  );
}
