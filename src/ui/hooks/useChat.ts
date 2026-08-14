import {
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { runAgentLoop } from "../../agent/loop.js";
import { clearHistory } from "../../agent/history.js";
import { resetDefaultSkillSessionState } from "../../agent/runtime.js";
import type { AgentEvent } from "../../agent/types.js";
import {
  finalizeAssistantTurn,
  hasAssistantTurnContent,
} from "../assistantTurn.js";
import type { AssistantTurn } from "../assistantTurn.js";
import type { ContextUsageState } from "../contextUsage.js";
import {
  consumeChatEvent,
  createChatEventSession,
  markLoadingContextUsageError,
  type ChatEventHandlers,
} from "../chatEventReducer.js";
import type { ChatEntry, TextChatEntry } from "../chatTypes.js";
export type { ChatEntry, TextChatEntry, ToolCallEntry, ToolResultEntry } from "../chatTypes.js";

export interface AgentRunOptions {
  signal?: AbortSignal;
}

export type AgentRunner = (
  userMessage: string,
  options?: AgentRunOptions,
) => AsyncGenerator<AgentEvent>;

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
  signal: AbortSignal;
  run: ActiveRun;
}

interface ActiveRun {
  id: number;
  currentIdRef: MutableRefObject<number>;
}

interface ChatRuntimeRefs {
  abortControllerRef: MutableRefObject<AbortController | null>;
  activeRunIdRef: MutableRefObject<number>;
  streamingReasoningRef: MutableRefObject<string>;
  streamingAssistantTurnRef: MutableRefObject<AssistantTurn | null>;
}

const INTERRUPTED_MESSAGE = "对话已中断";

export function useChat(options: UseChatOptions = {}) {
  const agentRunner = options.agentRunner ?? runAgentLoop;
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingAssistantTurn, setStreamingAssistantTurn] = useState<AssistantTurn | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageState>({
    status: "idle",
  });
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);
  const streamingReasoningRef = useRef(streamingReasoning);
  const streamingAssistantTurnRef = useRef(streamingAssistantTurn);

  const append = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };
  streamingReasoningRef.current = streamingReasoning;
  streamingAssistantTurnRef.current = streamingAssistantTurn;
  const setters = { setIsStreaming, setStreamingReasoning, setStreamingAssistantTurn, setContextUsage };
  const runtimeRefs = {
    abortControllerRef,
    activeRunIdRef,
    streamingReasoningRef,
    streamingAssistantTurnRef,
  };

  const sendMessage = createSendMessage({
    agentRunner,
    append,
    setters,
    isStreaming,
    runtimeRefs,
  });
  const interrupt = createInterrupt(runtimeRefs, setters, append);
  const clearChat = createClearChat(setEntries, setters);
  const appendSystemMessage = (content: string) => append(makeEntry("system", content));

  return {
    entries,
    isStreaming,
    streamingAssistantTurn,
    streamingReasoning,
    contextUsage,
    sendMessage,
    interrupt,
    clearChat,
    appendSystemMessage,
  };
}

function createSendMessage(input: {
  agentRunner: AgentRunner;
  append: (entry: ChatEntry) => void;
  setters: ChatStateSetters;
  isStreaming: boolean;
  runtimeRefs: ChatRuntimeRefs;
}): (text: string) => Promise<void> {
  return async (text) => {
    if (input.isStreaming || !text.trim()) return;
    const controller = startAgentRun(text, input);
    await runMessageStream(text, {
      agentRunner: input.agentRunner,
      append: input.append,
      setters: input.setters,
      signal: controller.signal,
      run: currentRun(input.runtimeRefs.activeRunIdRef),
    });
  };
}

async function runMessageStream(
  text: string,
  input: StreamRunInput,
): Promise<void> {
  try {
    await consumeEvents({ text, ...input });
  } catch (err) {
    if (isActiveRun(input.run)) appendSendError(err, input.append, input.setters);
  } finally {
    if (isActiveRun(input.run)) finishStreamingMessage(input.setters);
  }
}

async function consumeEvents(
  input: StreamRunInput & { text: string },
): Promise<void> {
  const session = createChatEventSession();
  const handlers = createEventHandlers(input.append, input.setters);
  for await (const event of input.agentRunner(input.text, { signal: input.signal })) {
    if (!isActiveRun(input.run)) return;
    consumeChatEvent(event, session, handlers);
  }
}

function startAgentRun(
  text: string,
  input: Parameters<typeof createSendMessage>[0],
): AbortController {
  const controller = new AbortController();
  input.runtimeRefs.activeRunIdRef.current += 1;
  input.runtimeRefs.abortControllerRef.current = controller;
  startStreamingMessage(text, input.append, input.setters);
  return controller;
}

function createInterrupt(
  refs: ChatRuntimeRefs,
  setters: ChatStateSetters,
  append: (entry: ChatEntry) => void,
): () => void {
  return () => {
    const interruptedEntries = createInterruptedEntries(refs);
    refs.abortControllerRef.current?.abort();
    refs.abortControllerRef.current = null;
    refs.activeRunIdRef.current += 1;
    interruptedEntries.forEach(append);
    finishStreamingMessage(setters);
    setters.setContextUsage({ status: "idle" });
  };
}

function createInterruptedEntries(refs: ChatRuntimeRefs): ChatEntry[] {
  return [
    ...createInterruptedThinkingEntries(refs.streamingReasoningRef.current),
    ...createInterruptedAssistantEntries(refs.streamingAssistantTurnRef.current),
    makeEntry("system", INTERRUPTED_MESSAGE),
  ];
}

function createInterruptedThinkingEntries(reasoning: string): ChatEntry[] {
  return reasoning ? [makeEntry("thinking", reasoning)] : [];
}

function createInterruptedAssistantEntries(turn: AssistantTurn | null): ChatEntry[] {
  if (!turn || !hasAssistantTurnContent(turn)) return [];
  return [finalizeAssistantTurn(turn, nextId(), "")];
}

const currentRun = (
  activeRunIdRef: MutableRefObject<number>,
): ActiveRun => ({
  id: activeRunIdRef.current,
  currentIdRef: activeRunIdRef,
});

const isActiveRun = (run: ActiveRun): boolean =>
  run.id === run.currentIdRef.current;

function createClearChat(
  setEntries: Dispatch<SetStateAction<ChatEntry[]>>,
  setters: ChatStateSetters,
): () => void {
  return () => {
    setEntries([]);
    clearHistory();
    resetDefaultSkillSessionState();
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
): ChatEventHandlers {
  return {
    append,
    makeEntry,
    nextId,
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
