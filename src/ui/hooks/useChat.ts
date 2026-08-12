import { useState, type Dispatch, type SetStateAction } from "react";
import { runAgentLoop } from "../../agent/loop.js";
import { clearHistory } from "../../agent/history.js";
import type { AgentEvent } from "../../agent/types.js";
import type { ToolResult } from "../../tools/types.js";
import {
  appendAssistantPart,
  appendAssistantTextDelta,
  createAssistantTurn,
  finalizeAssistantTurn,
  hasAssistantTurnContent,
} from "../assistantTurn.js";
import type { AssistantTurn } from "../assistantTurn.js";
import type { ContextUsageState } from "../contextUsage.js";
import { formatToolDisplay, formatToolErrorDisplay } from "../toolDisplay.js";

export interface ToolCallEntry {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEntry {
  callId: string;
  name: string;
  result: ToolResult;
}

export interface TextChatEntry {
  id: string;
  role: "system" | "user" | "thinking" | "tool_call" | "tool_result" | "error";
  content: string;
  toolCall?: ToolCallEntry;
  toolResult?: ToolResultEntry;
  timestamp: number;
}

export type ChatEntry = TextChatEntry | AssistantTurn;
export type AgentRunner = (userMessage: string) => AsyncGenerator<AgentEvent>;

export interface UseChatOptions {
  agentRunner?: AgentRunner;
}

let entryCounter = 0;
const nextId = (): string => `msg_${++entryCounter}`;

const makeEntry = (
  role: TextChatEntry["role"],
  content: string,
  extra?: Partial<Pick<TextChatEntry, "toolCall" | "toolResult">>,
): TextChatEntry => ({
  id: nextId(),
  role,
  content,
  timestamp: Date.now(),
  ...extra,
});

interface EventSession {
  reasoning: string;
  assistantTurn: AssistantTurn | null;
  pendingToolCalls: Map<string, ToolCallEntry>;
}

interface EventHandlers {
  append: (entry: ChatEntry) => void;
  setStreamingReasoning: (value: string) => void;
  setStreamingAssistantTurn: (value: AssistantTurn | null) => void;
  setContextUsage: Dispatch<SetStateAction<ContextUsageState>>;
}

interface ChatStateSetters {
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setStreamingReasoning: Dispatch<SetStateAction<string>>;
  setStreamingAssistantTurn: Dispatch<SetStateAction<AssistantTurn | null>>;
  setContextUsage: Dispatch<SetStateAction<ContextUsageState>>;
}

interface StreamRunInput {
  agentRunner: AgentRunner;
  append: (entry: ChatEntry) => void;
  setters: ChatStateSetters;
}

export function useChat(options: UseChatOptions = {}) {
  const agentRunner = options.agentRunner ?? runAgentLoop;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingAssistantTurn, setStreamingAssistantTurn] = useState<AssistantTurn | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageState>({
    status: "idle",
  });

  const append = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };
  const setters = { setIsStreaming, setStreamingReasoning, setStreamingAssistantTurn, setContextUsage };

  const sendMessage = createSendMessage({ agentRunner, append, setters, isStreaming });
  const clearChat = createClearChat(setEntries, setters);
  const appendSystemMessage = (content: string) => append(makeEntry("system", content));

  return {
    entries,
    isStreaming,
    streamingAssistantTurn,
    streamingReasoning,
    contextUsage,
    sendMessage,
    clearChat,
    appendSystemMessage,
  };
}

function createSendMessage(input: {
  agentRunner: AgentRunner;
  append: (entry: ChatEntry) => void;
  setters: ChatStateSetters;
  isStreaming: boolean;
}): (text: string) => Promise<void> {
  return async (text) => {
    if (input.isStreaming || !text.trim()) return;
    startStreamingMessage(text, input.append, input.setters);
    await runMessageStream(text, input);
  };
}

async function runMessageStream(
  text: string,
  input: StreamRunInput,
): Promise<void> {
  try {
    await consumeEvents({ text, ...input });
  } catch (err) {
    appendSendError(err, input.append, input.setters);
  } finally {
    finishStreamingMessage(input.setters);
  }
}

async function consumeEvents(
  input: StreamRunInput & { text: string },
): Promise<void> {
  const session = createEventSession();
  const handlers = createEventHandlers(input.append, input.setters);
  for await (const event of input.agentRunner(input.text)) {
    consumeAgentEvent(event, session, handlers);
  }
}

function createClearChat(
  setEntries: Dispatch<SetStateAction<ChatEntry[]>>,
  setters: ChatStateSetters,
): () => void {
  return () => {
    setEntries([]);
    clearHistory();
    setters.setStreamingAssistantTurn(null);
    setters.setContextUsage({ status: "idle" });
  };
}

function appendSendError(
  error: unknown,
  append: (entry: ChatEntry) => void,
  setters: ChatStateSetters,
): void {
  append(makeEntry("error", `错误: ${error instanceof Error ? error.message : String(error)}`));
  markLoadingContextUsageError(setters.setContextUsage);
}

function finishStreamingMessage(setters: ChatStateSetters): void {
  setters.setIsStreaming(false);
  setters.setStreamingReasoning("");
  setters.setStreamingAssistantTurn(null);
}

function createEventHandlers(
  append: (entry: ChatEntry) => void,
  setters: ChatStateSetters,
): EventHandlers {
  return {
    append,
    setStreamingReasoning: setters.setStreamingReasoning,
    setStreamingAssistantTurn: setters.setStreamingAssistantTurn,
    setContextUsage: setters.setContextUsage,
  };
}

function startStreamingMessage(
  text: string,
  append: (entry: ChatEntry) => void,
  setters: ChatStateSetters,
): void {
  append(makeEntry("user", text));
  setters.setIsStreaming(true);
  setters.setStreamingReasoning("");
  setters.setStreamingAssistantTurn(null);
  setters.setContextUsage({ status: "loading" });
}

function createEventSession(): EventSession {
  return {
    reasoning: "",
    assistantTurn: null,
    pendingToolCalls: new Map(),
  };
}

function consumeAgentEvent(
  event: AgentEvent,
  session: EventSession,
  handlers: EventHandlers,
): void {
  const handler = AGENT_EVENT_HANDLERS[event.type];
  handler(event as never, session, handlers);
}

const AGENT_EVENT_HANDLERS: {
  [Type in AgentEvent["type"]]: (
    event: Extract<AgentEvent, { type: Type }>,
    session: EventSession,
    handlers: EventHandlers,
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
  session: EventSession,
  handlers: EventHandlers,
): void {
  session.reasoning += content;
  handlers.setStreamingReasoning(session.reasoning);
}

function appendAssistantText(
  content: string,
  session: EventSession,
  handlers: EventHandlers,
): void {
  session.assistantTurn = appendAssistantTextDelta(
    session.assistantTurn ?? createAssistantTurn(nextId(), Date.now()),
    content,
  );
  handlers.setStreamingAssistantTurn(session.assistantTurn);
}

function rememberToolCall(event: Extract<AgentEvent, { type: "tool_call" }>, session: EventSession): void {
  session.pendingToolCalls.set(event.callId, {
    callId: event.callId,
    name: event.name,
    arguments: event.arguments,
  });
}

function appendToolResultSummary(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  session: EventSession,
  handlers: EventHandlers,
): void {
  const toolCall = takeToolCall(event, session);
  const content = formatToolResultSummary(event, toolCall);
  session.assistantTurn = appendAssistantPart(
    session.assistantTurn ?? createAssistantTurn(nextId(), Date.now()),
    nextId(),
    { id: nextId(), kind: event.result.success ? "tool" : "error", content },
  );
  handlers.setStreamingAssistantTurn(session.assistantTurn);
}

function takeToolCall(
  event: Extract<AgentEvent, { type: "tool_result" }>,
  session: EventSession,
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
  session: EventSession,
  handlers: EventHandlers,
): void {
  handlers.setContextUsage((current) =>
    current.status === "loading" ? { status: "error" } : current,
  );
  handlers.setStreamingReasoning("");
  if (session.reasoning) handlers.append(makeEntry("thinking", session.reasoning));

  session.assistantTurn = finalizeAssistantTurn(
    session.assistantTurn ?? createAssistantTurn(nextId(), Date.now()),
    nextId(),
    fullText || "（无回复内容）",
  );
  handlers.append(session.assistantTurn);
  session.assistantTurn = null;
  handlers.setStreamingAssistantTurn(null);
}

function appendError(
  error: string,
  session: EventSession,
  handlers: EventHandlers,
): void {
  if (!session.assistantTurn || !hasAssistantTurnContent(session.assistantTurn)) {
    appendStandaloneError(error, handlers);
    return;
  }

  appendTurnError(error, session, handlers);
}

function appendStandaloneError(error: string, handlers: EventHandlers): void {
  handlers.append(makeEntry("error", `错误: ${error}`));
  markContextUsageError(handlers);
}

function appendTurnError(
  error: string,
  session: EventSession,
  handlers: EventHandlers,
): void {
  if (!session.assistantTurn) return;
  session.assistantTurn = appendAssistantPart(session.assistantTurn, nextId(), createErrorPart(error));
  handlers.append(session.assistantTurn);
  session.assistantTurn = null;
  handlers.setStreamingAssistantTurn(null);
  markContextUsageError(handlers);
}

function createErrorPart(error: string): { id: string; kind: "error"; content: string } {
  return { id: nextId(), kind: "error", content: `错误: ${error}` };
}

function markContextUsageError(handlers: EventHandlers): void {
  markLoadingContextUsageError(handlers.setContextUsage);
}

function markLoadingContextUsageError(
  setContextUsage: Dispatch<SetStateAction<ContextUsageState>>,
): void {
  setContextUsage((current) =>
    current.status === "loading" ? { status: "error" } : current,
  );
}
