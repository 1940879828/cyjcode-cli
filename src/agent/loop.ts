import { streamChat as defaultStreamChat } from "../llm/client.js";
import type { ChatMessage, StreamEvent, ToolCall } from "../llm/types.js";
import { toolsToOpenAI } from "../tools/index.js";
import { appendProjectInstructionsToHistory } from "./sessionInstructions.js";
import type { AgentEvent } from "./types.js";
import { buildMessages } from "./messageBuilder.js";
import {
  observeHistory,
  shouldCompressHistory,
  type ObservedHistory,
  type ObservationStats,
} from "./observation.js";
import {
  consumeStreamEvent,
  createTurnResponse,
  logLlmResponse,
  type TurnResponse,
} from "./turnResponse.js";
import { executeToolCalls, type ToolExecutionBatch } from "./toolExecution.js";
import { toErrorMessage } from "./errors.js";
import { createDefaultAgentRuntime, type AgentRuntime } from "./runtime.js";
import { analyzeTurnIntake, buildTurnIntakeMessage } from "./turnIntake.js";

type StreamChat = (options: Parameters<typeof defaultStreamChat>[0]) => AsyncGenerator<StreamEvent>;

const MAX_ROUNDS = 50;
const EMPTY_REPLY = "（无回复内容）";

interface SessionContext {
  sessionId: string;
  runId: string;
  systemPrompt: string;
  tools: Record<string, unknown>[];
  runtime: AgentRuntime;
  turnIntakeMessage: ChatMessage | null;
  streamChat: StreamChat;
}

interface AgentLoopOptions {
  signal?: AbortSignal;
  runtime?: AgentRuntime;
  streamChatOverride?: StreamChat;
}

interface LlmRequestLogInput {
  context: SessionContext;
  turn: number;
  messageCount: number;
  observation: ObservationStats;
}

export async function* runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions = {},
): AsyncGenerator<AgentEvent> {
  const runtime = options.runtime ?? createDefaultAgentRuntime();
  const historyStart = runtime.history.getLength();
  const skillStateStart = runtime.skillManager.snapshot();
  const context = startSession(userMessage, runtime, options.streamChatOverride ?? defaultStreamChat);

  try {
    yield* runAgentSession(userMessage, context, options);
  } finally {
    if (options.signal?.aborted) {
      runtime.history.truncate(historyStart);
      runtime.skillManager.restore(skillStateStart);
    }
  }
}

async function* runAgentSession(
  userMessage: string,
  context: SessionContext,
  options: AgentLoopOptions,
): AsyncGenerator<AgentEvent> {
  yield { type: "user_message", content: userMessage };
  context.runtime.history.addMessage({ role: "user", content: userMessage });
  appendSkillInjections(userMessage, context);

  for (let turn = 1; turn <= MAX_ROUNDS; turn++) {
    if (options.signal?.aborted) return;
    const completed = yield* runAgentTurn(context, turn, options);
    if (completed) return;
  }
  yield* finishMaxRounds(context);
}

async function* runAgentTurn(
  context: SessionContext,
  turn: number,
  options: AgentLoopOptions,
): AsyncGenerator<AgentEvent, boolean> {
  yield { type: "turn_start", turn };

  try {
    const response = yield* emitLlmTurn(context, turn, options);
    return yield* handleTurnResponse(context, turn, response);
  } catch (error) {
    yield* finishWithError(context, turn, toErrorMessage(error));
    return true;
  }
}

async function* handleTurnResponse(
  context: SessionContext,
  turn: number,
  response: TurnResponse,
): AsyncGenerator<AgentEvent, boolean> {
  if (!response.toolCalls) {
    yield* finishTextResponse(context, turn, response.fullText);
    return true;
  }

  const toolCalls = selectExecutableToolCalls(response.toolCalls);
  addAssistantToolRequest(context, response, toolCalls);
  const waitingForUser = yield* executeToolCalls(createToolExecutionBatch(context, turn, toolCalls));
  yield { type: "turn_end", turn };
  return waitingForUser;
}

function createToolExecutionBatch(
  context: SessionContext,
  turn: number,
  toolCalls: ToolCall[],
): ToolExecutionBatch {
  return {
    sessionId: context.sessionId,
    turn,
    toolCalls,
    history: context.runtime.history,
    workspaceRoot: context.runtime.workspaceRoot,
    skillManager: context.runtime.skillManager,
    observationStore: context.runtime.observationStore,
  };
}

function startSession(userMessage: string, runtime: AgentRuntime, streamChat: StreamChat): SessionContext {
  const runId = generateRunId();
  runtime.log("session.start", { sessionId: runtime.sessionId, runId, userMessage });
  appendProjectInstructionsToHistory(runtime.workspaceRoot, runtime.history);
  return {
    sessionId: runtime.sessionId,
    runId,
    systemPrompt: runtime.buildSystemPrompt(),
    tools: toolsToOpenAI(),
    runtime,
    turnIntakeMessage: buildTurnIntakeMessage(analyzeTurnIntake(userMessage)),
    streamChat,
  };
}

function appendSkillInjections(userMessage: string, context: SessionContext): void {
  const injections = context.runtime.skillManager.routeUserMessage(userMessage);
  for (const injection of injections) context.runtime.history.addMessage(injection);
}

async function* emitLlmTurn(
  context: SessionContext,
  turn: number,
  options: AgentLoopOptions,
): AsyncGenerator<AgentEvent, TurnResponse> {
  const observed = yield* observeRuntimeHistory(context, turn, options.signal);
  const messages = buildMessages(context.systemPrompt, messagesWithTurnIntake(observed.messages, context));
  logLlmRequest({ context, turn, messageCount: messages.length, observation: observed.stats });

  const response = createTurnResponse();
  for await (const event of context.streamChat(createStreamChatOptions(context, messages, options))) {
    throwIfAborted(options.signal);
    const forwarded = consumeStreamEvent(event, { sessionId: context.sessionId, turn, response });
    if (forwarded) yield forwarded;
  }

  logLlmResponse(context.sessionId, turn, response);
  return response;
}

function messagesWithTurnIntake(messages: ChatMessage[], context: SessionContext): ChatMessage[] {
  return context.turnIntakeMessage ? [...messages, context.turnIntakeMessage] : messages;
}

async function* observeRuntimeHistory(
  context: SessionContext,
  turn: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<AgentEvent, ObservedHistory> {
  const history = context.runtime.history.getMessages();
  if (shouldCompressHistory(history)) {
    yield { type: "context_compression_start", turn };
    await yieldToUi();
    throwIfAborted(signal);
  }

  const observed = observeHistory({ history, store: context.runtime.observationStore });
  if (observed.compressed) yield { type: "context_compression_end", turn, stats: observed.stats };
  return observed;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function logLlmRequest(input: LlmRequestLogInput): void {
  const { context, turn, messageCount, observation } = input;
  context.runtime.log("llm.request", {
    sessionId: context.sessionId,
    runId: context.runId,
    turn,
    messageCount,
    observation,
  });
}

function createStreamChatOptions(
  context: SessionContext,
  messages: ChatMessage[],
  options: AgentLoopOptions,
): Parameters<StreamChat>[0] {
  return {
    messages,
    tools: context.tools,
    signal: options.signal,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("已中断");
}

async function* finishTextResponse(
  context: SessionContext,
  turn: number,
  fullText: string,
): AsyncGenerator<AgentEvent> {
  const content = fullText || EMPTY_REPLY;
  context.runtime.history.addMessage({ role: "assistant", content });
  yield { type: "turn_end", turn };
  yield { type: "done", fullText: content };
  context.runtime.log("session.end", {
    sessionId: context.sessionId,
    runId: context.runId,
    status: "success",
    totalTurns: turn,
  });
}

export function selectExecutableToolCalls(toolCalls: ToolCall[]): ToolCall[] {
  const questionIndex = toolCalls.findIndex((toolCall) => toolCall.function.name === "AskUserQuestion");
  return questionIndex === -1 ? toolCalls : toolCalls.slice(0, questionIndex + 1);
}

function addAssistantToolRequest(context: SessionContext, response: TurnResponse, toolCalls: ToolCall[]): void {
  context.runtime.history.addMessage({
    role: "assistant",
    content: response.fullText || null,
    tool_calls: toolCalls,
  });
}

function* finishWithError(
  context: SessionContext,
  turn: number,
  error: string,
): Generator<AgentEvent> {
  context.runtime.log("error", { sessionId: context.sessionId, runId: context.runId, turn, message: error });
  yield { type: "error", error };
  yield { type: "turn_end", turn };
  context.runtime.log("session.end", {
    sessionId: context.sessionId,
    runId: context.runId,
    status: "error",
    totalTurns: turn,
  });
}

function* finishMaxRounds(context: SessionContext): Generator<AgentEvent> {
  const error = `已达到最大工具调用轮数 (${MAX_ROUNDS})，终止循环`;
  context.runtime.log("error", {
    sessionId: context.sessionId,
    runId: context.runId,
    message: `达到最大轮数限制 (${MAX_ROUNDS})`,
  });
  context.runtime.log("session.end", {
    sessionId: context.sessionId,
    runId: context.runId,
    status: "max_rounds",
    totalTurns: MAX_ROUNDS,
  });
  yield { type: "error", error };
}

function generateRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
