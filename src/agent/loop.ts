import { streamChat } from "../llm/client.js";
import type { ChatMessage, ToolCall } from "../llm/types.js";
import { toolsToOpenAI } from "../tools/index.js";
import { appendProjectInstructionsToHistory } from "./sessionInstructions.js";
import type { AgentEvent } from "./types.js";
import { buildMessages } from "./messageBuilder.js";
import {
  consumeStreamEvent,
  createTurnResponse,
  logLlmResponse,
  type TurnResponse,
} from "./turnResponse.js";
import { executeToolCalls, type ToolExecutionBatch } from "./toolExecution.js";
import { toErrorMessage } from "./errors.js";
import { createDefaultAgentRuntime, type AgentRuntime } from "./runtime.js";

const MAX_ROUNDS = 50;
const EMPTY_REPLY = "（无回复内容）";

interface SessionContext {
  sessionId: string;
  systemPrompt: string;
  tools: Record<string, unknown>[];
  runtime: AgentRuntime;
}

interface AgentLoopOptions {
  signal?: AbortSignal;
  runtime?: AgentRuntime;
}

export async function* runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions = {},
): AsyncGenerator<AgentEvent> {
  const runtime = options.runtime ?? createDefaultAgentRuntime();
  const historyStart = runtime.history.getLength();
  const skillStateStart = runtime.skillManager.snapshot();
  const context = startSession(userMessage, runtime);

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

  addAssistantToolRequest(context, response);
  yield* executeToolCalls(createToolExecutionBatch(context, turn, response.toolCalls));
  yield { type: "turn_end", turn };
  return false;
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
  };
}

function startSession(userMessage: string, runtime: AgentRuntime): SessionContext {
  const sessionId = generateSessionId();
  runtime.log("session.start", { sessionId, userMessage });
  appendProjectInstructionsToHistory(runtime.workspaceRoot, runtime.history);
  return {
    sessionId,
    systemPrompt: runtime.buildSystemPrompt(),
    tools: toolsToOpenAI(),
    runtime,
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
  const messages = buildMessages(context.systemPrompt, context.runtime.history.getMessages());
  context.runtime.log("llm.request", { sessionId: context.sessionId, turn, messageCount: messages.length });

  const response = createTurnResponse();
  for await (const event of streamChat(createStreamChatOptions(context, messages, options))) {
    throwIfAborted(options.signal);
    const forwarded = consumeStreamEvent(event, { sessionId: context.sessionId, turn, response });
    if (forwarded) yield forwarded;
  }

  logLlmResponse(context.sessionId, turn, response);
  return response;
}

function createStreamChatOptions(
  context: SessionContext,
  messages: ChatMessage[],
  options: AgentLoopOptions,
): Parameters<typeof streamChat>[0] {
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
  context.runtime.log("session.end", { sessionId: context.sessionId, status: "success", totalTurns: turn });
}

function addAssistantToolRequest(context: SessionContext, response: TurnResponse): void {
  context.runtime.history.addMessage({
    role: "assistant",
    content: response.fullText || null,
    tool_calls: response.toolCalls ?? undefined,
  });
}

function* finishWithError(
  context: SessionContext,
  turn: number,
  error: string,
): Generator<AgentEvent> {
  context.runtime.log("error", { sessionId: context.sessionId, turn, message: error });
  yield { type: "error", error };
  yield { type: "turn_end", turn };
  context.runtime.log("session.end", { sessionId: context.sessionId, status: "error", totalTurns: turn });
}

function* finishMaxRounds(context: SessionContext): Generator<AgentEvent> {
  const error = `已达到最大工具调用轮数 (${MAX_ROUNDS})，终止循环`;
  context.runtime.log("error", { sessionId: context.sessionId, message: `达到最大轮数限制 (${MAX_ROUNDS})` });
  context.runtime.log("session.end", { sessionId: context.sessionId, status: "max_rounds", totalTurns: MAX_ROUNDS });
  yield { type: "error", error };
}

function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
