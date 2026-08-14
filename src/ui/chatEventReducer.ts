import type { Dispatch, SetStateAction } from "react";
import type { AgentEvent } from "../agent/types.js";
import type { AskUserQuestionItem } from "../agent/types.js";
import {
  appendAssistantPart,
  appendAssistantTextDelta,
  createAssistantTurn,
  finalizeAssistantTurn,
  hasAssistantTurnContent,
  replaceAssistantPart,
} from "./assistantTurn.js";
import type { AssistantTurn, AssistantTurnPart } from "./assistantTurn.js";
import type { ContextUsageState } from "./contextUsage.js";
import { formatPendingToolDisplay, formatToolDisplay, formatToolErrorDisplay } from "./toolDisplay.js";
import type { ChatEntry, TextChatEntry, ToolCallEntry } from "./chatTypes.js";

interface PendingToolCall extends ToolCallEntry {
  partId?: string;
}

interface ReplacePendingToolPartInput {
  session: ChatEventSession;
  handlers: ChatEventHandlers;
  partId: string | undefined;
  part: AssistantTurnPart;
}

export const CONTEXT_COMPRESSION_MESSAGE = "自动压缩中……";

export interface ChatEventSession {
  reasoning: string;
  assistantTurn: AssistantTurn | null;
  pendingToolCalls: Map<string, PendingToolCall>;
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
  setPendingQuestion: (value: PendingAskUserQuestion | null) => void;
}

export interface PendingAskUserQuestion {
  callId: string;
  questions: AskUserQuestionItem[];
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
  tool_call_delta: ignoreAgentEvent,
  tool_call: appendPendingToolCall,
  tool_result: appendToolResultSummary,
  await_user_input: finishAwaitUserInput,
  usage: (event, _session, handlers) => handlers.setContextUsage({ status: "ready", usage: event.usage }),
  done: (event, session, handlers) => finalizeTurn(event.fullText, session, handlers),
  error: (event, session, handlers) => appendError(event.error, session, handlers),
  context_compression_start: (_event, _session, handlers) =>
    handlers.setStreamingReasoning(CONTEXT_COMPRESSION_MESSAGE),
  context_compression_end: (_event, session, handlers) =>
    handlers.setStreamingReasoning(session.reasoning),
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

function appendPendingToolCall(
  event: Extract<AgentEvent, { type: "tool_call" }>,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  const partId = handlers.nextId();
  session.pendingToolCalls.set(event.callId, {
    callId: event.callId,
    name: event.name,
    arguments: event.arguments,
    partId,
  });
  session.assistantTurn = appendAssistantPart(
    session.assistantTurn ?? createAssistantTurn(handlers.nextId(), Date.now()),
    handlers.nextId(),
    { id: partId, kind: "tool", content: formatPendingToolDisplay(event) },
  );
  handlers.setStreamingAssistantTurn(session.assistantTurn);
}

function appendToolResultSummary(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  const toolCall = takeToolCall(event, session);
  const part = createToolResultPart(event, toolCall, handlers.nextId());
  if (replacePendingToolPart({ session, handlers, partId: toolCall.partId, part })) return;

  session.assistantTurn = appendAssistantPart(
    session.assistantTurn ?? createAssistantTurn(handlers.nextId(), Date.now()),
    handlers.nextId(),
    part,
  );
  handlers.setStreamingAssistantTurn(session.assistantTurn);
}

function replacePendingToolPart(input: ReplacePendingToolPartInput): boolean {
  const { session, handlers, partId, part } = input;
  if (!partId || !session.assistantTurn) return false;
  const nextTurn = replaceAssistantPart(session.assistantTurn, partId, { ...part, id: partId });
  if (nextTurn === session.assistantTurn) return false;
  session.assistantTurn = nextTurn;
  handlers.setStreamingAssistantTurn(nextTurn);
  return true;
}

function createToolResultPart(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  toolCall: ToolCallEntry,
  id: string,
): AssistantTurnPart {
  return {
    id,
    kind: event.result.success ? "tool" : "error",
    content: formatToolResultSummary(event, toolCall),
  };
}

function takeToolCall(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  session: ChatEventSession,
): PendingToolCall {
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

function finishAwaitUserInput(
  event: Extract<AgentEvent, { type: "await_user_input" }>,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  handlers.setContextUsage((current) =>
    current.status === "loading" ? { status: "idle" } : current,
  );
  handlers.setStreamingReasoning("");
  if (session.reasoning) handlers.append(handlers.makeEntry("thinking", session.reasoning));
  if (session.assistantTurn && hasAssistantTurnContent(session.assistantTurn)) {
    handlers.append(finalizeAssistantTurn(session.assistantTurn, handlers.nextId(), ""));
  }
  session.reasoning = "";
  session.assistantTurn = null;
  handlers.setStreamingAssistantTurn(null);
  handlers.setPendingQuestion({ callId: event.callId, questions: event.questions });
}

function appendError(
  error: string,
  session: ChatEventSession,
  handlers: ChatEventHandlers,
): void {
  handlers.setStreamingReasoning("");
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
