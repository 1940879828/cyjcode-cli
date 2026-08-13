import { streamChat } from "../llm/client.js";
import type { ChatMessage } from "../llm/types.js";
import { toolsToOpenAI } from "../tools/index.js";
import { log } from "../utils/logger.js";
import {
  addMessage,
  getHistoryLength,
  truncateHistory,
} from "./history.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendProjectInstructionsToHistory } from "./sessionInstructions.js";
import type { AgentEvent } from "./types.js";
import { buildMessages } from "./messageBuilder.js";
import {
  consumeStreamEvent,
  createTurnResponse,
  logLlmResponse,
  type TurnResponse,
} from "./turnResponse.js";
import { executeToolCalls } from "./toolExecution.js";
import { toErrorMessage } from "./errors.js";

const MAX_ROUNDS = 50;
const EMPTY_REPLY = "（无回复内容）";

interface SessionContext {
  sessionId: string;
  systemPrompt: string;
  tools: Record<string, unknown>[];
}

interface AgentLoopOptions {
  signal?: AbortSignal;
}

export async function* runAgentLoop(
  userMessage: string,
  options: AgentLoopOptions = {},
): AsyncGenerator<AgentEvent> {
  const historyStart = getHistoryLength();
  const context = startSession(userMessage);

  try {
    yield* runAgentSession(userMessage, context, options);
  } finally {
    if (options.signal?.aborted) truncateHistory(historyStart);
  }
}

async function* runAgentSession(
  userMessage: string,
  context: SessionContext,
  options: AgentLoopOptions,
): AsyncGenerator<AgentEvent> {
  yield { type: "user_message", content: userMessage };
  addMessage({ role: "user", content: userMessage });

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

  addAssistantToolRequest(response);
  yield* executeToolCalls({ sessionId: context.sessionId, turn, toolCalls: response.toolCalls });
  yield { type: "turn_end", turn };
  return false;
}

function startSession(userMessage: string): SessionContext {
  const sessionId = generateSessionId();
  log("session.start", { sessionId, userMessage });
  appendProjectInstructionsToHistory();
  return {
    sessionId,
    systemPrompt: buildSystemPrompt(),
    tools: toolsToOpenAI(),
  };
}

async function* emitLlmTurn(
  context: SessionContext,
  turn: number,
  options: AgentLoopOptions,
): AsyncGenerator<AgentEvent, TurnResponse> {
  const messages = buildMessages(context.systemPrompt);
  log("llm.request", { sessionId: context.sessionId, turn, messageCount: messages.length });

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
  addMessage({ role: "assistant", content });
  yield { type: "turn_end", turn };
  yield { type: "done", fullText: content };
  log("session.end", { sessionId: context.sessionId, status: "success", totalTurns: turn });
}

function addAssistantToolRequest(response: TurnResponse): void {
  addMessage({
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
  log("error", { sessionId: context.sessionId, turn, message: error });
  yield { type: "error", error };
  yield { type: "turn_end", turn };
  log("session.end", { sessionId: context.sessionId, status: "error", totalTurns: turn });
}

function* finishMaxRounds(context: SessionContext): Generator<AgentEvent> {
  const error = `已达到最大工具调用轮数 (${MAX_ROUNDS})，终止循环`;
  log("error", { sessionId: context.sessionId, message: `达到最大轮数限制 (${MAX_ROUNDS})` });
  log("session.end", { sessionId: context.sessionId, status: "max_rounds", totalTurns: MAX_ROUNDS });
  yield { type: "error", error };
}

function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
