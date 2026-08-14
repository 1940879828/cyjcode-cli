import {
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { runAgentLoop } from "../../agent/loop.js";
import {
  createDefaultAgentRuntime,
  createTransientAgentRuntime,
  resetDefaultSkillSessionState,
  type AgentRuntime,
} from "../../agent/runtime.js";
import { defaultSessionStore, type SessionInfo } from "../../agent/sessionStore.js";
import type { AgentEvent } from "../../agent/types.js";
import type { ChatMessage } from "../../llm/types.js";
import {
  finalizeAssistantTurn,
  hasAssistantTurnContent,
} from "../assistantTurn.js";
import type { AssistantTurn } from "../assistantTurn.js";
import type { ContextUsageState } from "../contextUsage.js";
import {
  CONTEXT_COMPRESSION_MESSAGE,
  consumeChatEvent,
  createChatEventSession,
  markLoadingContextUsageError,
  type ChatEventHandlers,
  type PendingAskUserQuestion,
} from "../chatEventReducer.js";
import type { ChatEntry, TextChatEntry } from "../chatTypes.js";
import { messagesToChatEntries } from "../historyTranscript.js";
export type { ChatEntry, TextChatEntry, ToolCallEntry, ToolResultEntry } from "../chatTypes.js";

export interface AgentRunOptions {
  signal?: AbortSignal;
  runtime?: AgentRuntime;
}

export type AgentRunner = (
  userMessage: string,
  options?: AgentRunOptions,
) => AsyncGenerator<AgentEvent>;

export interface UseChatOptions {
  agentRunner?: AgentRunner;
  initialSessionId?: string;
  persistSessions?: boolean;
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
  setPendingQuestion: Dispatch<SetStateAction<PendingAskUserQuestion | null>>;
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
  agentRuntimeRef: MutableRefObject<AgentRuntime>;
  streamingReasoningRef: MutableRefObject<string>;
  streamingAssistantTurnRef: MutableRefObject<AssistantTurn | null>;
}

interface ChatState {
  entries: ChatEntry[];
  isStreaming: boolean;
  streamingReasoning: string;
  streamingAssistantTurn: AssistantTurn | null;
  contextUsage: ContextUsageState;
  pendingQuestion: PendingAskUserQuestion | null;
  setters: ChatStateSetters;
  append: (entry: ChatEntry) => void;
  setEntries: Dispatch<SetStateAction<ChatEntry[]>>;
}

const INTERRUPTED_MESSAGE = "对话已中断";

interface SessionSwitchInput {
  runtimeRef: MutableRefObject<AgentRuntime>;
  setEntries: Dispatch<SetStateAction<ChatEntry[]>>;
  setters: ChatStateSetters;
}

interface SessionCommandsInput extends SessionSwitchInput {
  persistSessions: boolean;
}

export function useChat(options: UseChatOptions = {}) {
  const persistSessions = options.persistSessions ?? true;
  const agentRuntimeRef = useAgentRuntimeRef({
    sessionId: options.initialSessionId,
    persistSessions,
  });
  const agentRunner = createRuntimeAgentRunner(options.agentRunner, agentRuntimeRef);
  const state = useChatState(agentRuntimeRef.current.history.getMessages());
  const runtimeRefs = useChatRefs(agentRuntimeRef, state.streamingReasoning, state.streamingAssistantTurn);
  const sendMessage = createSendMessage({
    agentRunner,
    append: state.append,
    setters: state.setters,
    isStreaming: state.isStreaming,
    runtimeRefs,
  });
  const interrupt = createInterrupt(runtimeRefs, state.setters, state.append);
  const clearChat = createClearChat(agentRuntimeRef, state.setEntries, state.setters);
  const appendSystemMessage = (content: string) => state.append(makeEntry("system", content));
  const submitQuestionAnswers = createSubmitQuestionAnswers(state.setters.setPendingQuestion, sendMessage);
  const dismissQuestion = () => state.setters.setPendingQuestion(null);
  const sessionCommands = createSessionCommands({
    runtimeRef: agentRuntimeRef,
    setEntries: state.setEntries,
    setters: state.setters,
    persistSessions,
  });

  return {
    entries: state.entries,
    isStreaming: state.isStreaming,
    streamingAssistantTurn: state.streamingAssistantTurn,
    streamingReasoning: state.streamingReasoning,
    contextUsage: state.contextUsage,
    pendingQuestion: state.pendingQuestion,
    sendMessage,
    submitQuestionAnswers,
    dismissQuestion,
    interrupt,
    clearChat,
    appendSystemMessage,
    ...sessionCommands,
  };
}

function useAgentRuntimeRef(input: {
  sessionId: string | undefined;
  persistSessions: boolean;
}): MutableRefObject<AgentRuntime> {
  const ref = useRef<AgentRuntime | null>(null);
  if (!ref.current) ref.current = createInitialRuntime(input);
  return ref as MutableRefObject<AgentRuntime>;
}

function createInitialRuntime(input: {
  sessionId: string | undefined;
  persistSessions: boolean;
}): AgentRuntime {
  if (!input.persistSessions) return createTransientAgentRuntime();
  return createDefaultAgentRuntime({ sessionId: input.sessionId });
}

function createRuntimeAgentRunner(
  agentRunner: AgentRunner | undefined,
  runtimeRef: MutableRefObject<AgentRuntime>,
): AgentRunner {
  if (agentRunner) return (text, options) => agentRunner(text, { ...options, runtime: runtimeRef.current });
  return (text, options) => runAgentLoop(text, { ...options, runtime: runtimeRef.current });
}

function useChatState(messages: ChatMessage[]): ChatState {
  const [entries, setEntries] = useState<ChatEntry[]>(() =>
    messagesToChatEntries(messages, { nextId, now: Date.now })
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingAssistantTurn, setStreamingAssistantTurn] = useState<AssistantTurn | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageState>({
    status: "idle",
  });
  const [pendingQuestion, setPendingQuestion] = useState<PendingAskUserQuestion | null>(null);
  const append = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };
  const setters = {
    setIsStreaming,
    setStreamingReasoning,
    setStreamingAssistantTurn,
    setContextUsage,
    setPendingQuestion,
  };
  return { entries, isStreaming, streamingReasoning, streamingAssistantTurn, contextUsage, pendingQuestion, setters, append, setEntries };
}

function useChatRefs(
  agentRuntimeRef: MutableRefObject<AgentRuntime>,
  streamingReasoning: string,
  streamingAssistantTurn: AssistantTurn | null,
): ChatRuntimeRefs {
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunIdRef = useRef(0);
  const streamingReasoningRef = useRef(streamingReasoning);
  const streamingAssistantTurnRef = useRef(streamingAssistantTurn);
  streamingReasoningRef.current = streamingReasoning;
  streamingAssistantTurnRef.current = streamingAssistantTurn;
  return {
    abortControllerRef,
    activeRunIdRef,
    agentRuntimeRef,
    streamingReasoningRef,
    streamingAssistantTurnRef,
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
    setters.setPendingQuestion(null);
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
  if (!reasoning || reasoning === CONTEXT_COMPRESSION_MESSAGE) return [];
  return [makeEntry("thinking", reasoning)];
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
  runtimeRef: MutableRefObject<AgentRuntime>,
  setEntries: Dispatch<SetStateAction<ChatEntry[]>>,
  setters: ChatStateSetters,
): () => void {
  return () => {
    setEntries([]);
    runtimeRef.current.history.truncate(0);
    resetDefaultSkillSessionState();
    resetTransientChatState(setters);
  };
}

function createSessionCommands(input: SessionCommandsInput) {
  if (!input.persistSessions) return createTransientSessionCommands(input);
  return {
    newSession: () => switchToNewSession(input),
    listSessions: () => formatSessionList(defaultSessionStore.listSessions(input.runtimeRef.current.workspaceRoot)),
    resumeSession: (sessionId: string) => resumeSession(sessionId, input),
  };
}

function createTransientSessionCommands(input: SessionSwitchInput) {
  return {
    newSession: () => switchToTransientSession(input),
    listSessions: () => "devmock 模式不保存会话",
    resumeSession: () => "devmock 模式不支持恢复持久会话",
  };
}

function switchToTransientSession(input: SessionSwitchInput): string {
  input.runtimeRef.current = createTransientAgentRuntime(input.runtimeRef.current.workspaceRoot);
  resetDefaultSkillSessionState();
  input.setEntries([]);
  resetTransientChatState(input.setters);
  return `已创建临时会话: ${input.runtimeRef.current.sessionId}`;
}

function switchToNewSession(input: SessionSwitchInput): string {
  const session = defaultSessionStore.createSession(input.runtimeRef.current.workspaceRoot);
  input.runtimeRef.current = createDefaultAgentRuntime({ sessionId: session.id });
  resetDefaultSkillSessionState();
  input.setEntries([]);
  resetTransientChatState(input.setters);
  return `已创建新会话: ${session.id}`;
}

function resumeSession(
  sessionId: string,
  input: SessionSwitchInput,
): string {
  const workspaceRoot = input.runtimeRef.current.workspaceRoot;
  if (!defaultSessionStore.setCurrentSession(workspaceRoot, sessionId)) return `未找到会话: ${sessionId}`;
  input.runtimeRef.current = createDefaultAgentRuntime({ sessionId });
  resetDefaultSkillSessionState();
  input.setEntries(messagesToChatEntries(input.runtimeRef.current.history.getMessages(), {
    nextId,
    now: Date.now,
  }));
  resetTransientChatState(input.setters);
  return `已恢复会话: ${sessionId}`;
}

function resetTransientChatState(setters: ChatStateSetters): void {
  setters.setStreamingAssistantTurn(null);
  setters.setStreamingReasoning("");
  setters.setContextUsage({ status: "idle" });
  setters.setPendingQuestion(null);
}

function formatSessionList(sessions: SessionInfo[]): string {
  if (sessions.length === 0) return "暂无会话";
  return ["当前工作区会话:", "", ...sessions.map(formatSessionLine)].join("\n");
}

function formatSessionLine(session: SessionInfo): string {
  const updated = new Date(session.updatedAt).toLocaleString();
  return `  ${session.id}  ${session.title}  (${session.messageCount} messages, ${updated})`;
}

function createSubmitQuestionAnswers(
  setPendingQuestion: Dispatch<SetStateAction<PendingAskUserQuestion | null>>,
  sendMessage: (text: string) => Promise<void>,
): (answers: Record<string, string>) => Promise<void> {
  return async (answers) => {
    setPendingQuestion(null);
    await sendMessage(formatAskUserQuestionAnswers(answers));
  };
}

function formatAskUserQuestionAnswers(answers: Record<string, string>): string {
  const answerText = Object.entries(answers)
    .map(([question, answer]) => `"${escapeAnswerPart(question)}"="${escapeAnswerPart(answer)}"`)
    .join(", ");
  return `User has answered your questions: ${answerText}. You can now continue with the user's answers in mind.`;
}

function escapeAnswerPart(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
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
    setPendingQuestion: setters.setPendingQuestion,
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
