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

  const consumeEvents = async (text: string) => {
    const session = createEventSession();
    const handlers = {
      append,
      setStreamingReasoning,
      setStreamingAssistantTurn,
      setContextUsage,
    };

    for await (const event of agentRunner(text)) {
      consumeAgentEvent(event, session, handlers);
    }
  };

  const sendMessage = async (text: string) => {
    if (isStreaming || !text.trim()) return;

    append(makeEntry("user", text));
    setIsStreaming(true);
    setStreamingReasoning("");
    setStreamingAssistantTurn(null);
    setContextUsage({ status: "loading" });

    try {
      await consumeEvents(text);
    } catch (err) {
      append(makeEntry("error", `错误: ${err instanceof Error ? err.message : String(err)}`));
      setContextUsage((current) =>
        current.status === "loading" ? { status: "error" } : current,
      );
    } finally {
      setIsStreaming(false);
      setStreamingReasoning("");
      setStreamingAssistantTurn(null);
    }
  };

  const clearChat = () => {
    setEntries([]);
    clearHistory();
    setStreamingAssistantTurn(null);
    setContextUsage({ status: "idle" });
  };

  const appendSystemMessage = (content: string) => {
    append(makeEntry("system", content));
  };

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
  switch (event.type) {
    case "reasoning_delta":
      appendReasoning(event.content, session, handlers);
      return;
    case "text_delta":
      appendAssistantText(event.content, session, handlers);
      return;
    case "tool_call":
      rememberToolCall(event, session);
      return;
    case "tool_result":
      appendToolResultSummary(event, session, handlers);
      return;
    case "usage":
      handlers.setContextUsage({ status: "ready", usage: event.usage });
      return;
    case "done":
      finalizeTurn(event.fullText, session, handlers);
      return;
    case "error":
      appendError(event.error, session, handlers);
      return;
    case "turn_start":
    case "turn_end":
    case "user_message":
      return;
  }
}

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
    handlers.append(makeEntry("error", `错误: ${error}`));
    markContextUsageError(handlers);
    return;
  }

  session.assistantTurn = appendAssistantPart(session.assistantTurn, nextId(), {
    id: nextId(),
    kind: "error",
    content: `错误: ${error}`,
  });
  handlers.append(session.assistantTurn);
  session.assistantTurn = null;
  handlers.setStreamingAssistantTurn(null);
  markContextUsageError(handlers);
}

function markContextUsageError(handlers: EventHandlers): void {
  handlers.setContextUsage((current) =>
    current.status === "loading" ? { status: "error" } : current,
  );
}
