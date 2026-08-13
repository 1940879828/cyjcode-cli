import { streamChat } from "../llm/client.js";
import type { ChatMessage, StreamEvent, TokenUsage, ToolCall } from "../llm/types.js";
import { getTool, toolsToOpenAI } from "../tools/index.js";
import type { ToolResult } from "../tools/types.js";
import { log } from "../utils/logger.js";
import { addMessage, appendToolResult, getMessages } from "./history.js";
import { expandInitCommandMessages } from "./initCommand.js";
import { buildSystemPrompt } from "./prompt.js";
import { appendProjectInstructionsToHistory } from "./sessionInstructions.js";
import type { AgentEvent } from "./types.js";

const MAX_ROUNDS = 50;
const EMPTY_REPLY = "（无回复内容）";

interface SessionContext {
  sessionId: string;
  systemPrompt: string;
  tools: Record<string, unknown>[];
}

interface TurnResponse {
  fullText: string;
  toolCalls: ToolCall[] | null;
  usage: TokenUsage | null;
}

interface ToolExecutionContext {
  session: SessionContext;
  turn: number;
  toolCall: ToolCall;
  args: Record<string, unknown>;
}

export async function* runAgentLoop(
  userMessage: string,
): AsyncGenerator<AgentEvent> {
  const context = startSession(userMessage);

  yield { type: "user_message", content: userMessage };
  addMessage({ role: "user", content: userMessage });

  for (let turn = 1; turn <= MAX_ROUNDS; turn++) {
    const completed = yield* runAgentTurn(context, turn);
    if (completed) return;
  }

  yield* finishMaxRounds(context);
}

async function* runAgentTurn(
  context: SessionContext,
  turn: number,
): AsyncGenerator<AgentEvent, boolean> {
  yield { type: "turn_start", turn };

  try {
    const response = yield* emitLlmTurn(context, turn);
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
  yield* executeToolCalls(context, turn, response.toolCalls);
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
): AsyncGenerator<AgentEvent, TurnResponse> {
  const messages = buildMessages(context.systemPrompt);
  log("llm.request", { sessionId: context.sessionId, turn, messageCount: messages.length });

  const response = createTurnResponse();
  for await (const event of streamChat({ messages, tools: context.tools })) {
    const forwarded = consumeStreamEvent(event, response);
    if (forwarded) yield forwarded;
  }

  logLlmResponse(context, turn, response);
  return response;
}

function buildMessages(systemPrompt: string): ChatMessage[] {
  return [{ role: "system", content: systemPrompt }, ...expandInitCommandMessages(getMessages())];
}

function createTurnResponse(): TurnResponse {
  return { fullText: "", toolCalls: null, usage: null };
}

function consumeStreamEvent(
  event: StreamEvent,
  response: TurnResponse,
): AgentEvent | null {
  switch (event.type) {
    case "reasoning_delta":
      return { type: "reasoning_delta", content: event.content };
    case "text_delta":
      return consumeTextDelta(response, event.content);
    case "usage":
      return consumeUsage(response, event.usage);
    case "done":
      response.toolCalls = extractToolCalls(event.message.tool_calls);
      return null;
    case "tool_call_delta":
      return null;
    case "error":
      throw event.error;
  }
}

function consumeTextDelta(response: TurnResponse, content: string): AgentEvent {
  response.fullText += content;
  return { type: "text_delta", content };
}

function consumeUsage(response: TurnResponse, usage: TokenUsage): AgentEvent {
  response.usage = usage;
  return { type: "usage", usage };
}

function extractToolCalls(toolCalls: ToolCall[] | undefined): ToolCall[] | null {
  return toolCalls?.length ? toolCalls : null;
}

function logLlmResponse(
  context: SessionContext,
  turn: number,
  response: TurnResponse,
): void {
  log("llm.response", {
    sessionId: context.sessionId,
    turn,
    hasToolCalls: !!response.toolCalls,
    toolCallCount: response.toolCalls?.length ?? 0,
    responseLength: response.fullText.length,
    promptTokens: response.usage?.promptTokens,
    completionTokens: response.usage?.completionTokens,
    totalTokens: response.usage?.totalTokens,
  });
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

async function* executeToolCalls(
  context: SessionContext,
  turn: number,
  toolCalls: ToolCall[],
): AsyncGenerator<AgentEvent> {
  for (const toolCall of toolCalls) {
    const parsedArgs = parseToolArgs(toolCall.function.arguments);
    if (!parsedArgs) {
      yield* emitToolParseError(context, turn, toolCall);
      continue;
    }
    yield* emitToolExecution({ session: context, turn, toolCall, args: parsedArgs });
  }
}

async function* emitToolExecution(input: ToolExecutionContext): AsyncGenerator<AgentEvent> {
  const { toolCall, args } = input;
  const tool = getTool(toolCall.function.name);
  if (!tool) {
    yield* emitToolFailure({ ...input, errorMessage: "未注册的工具" });
    return;
  }

  logToolStart(input);
  const result = await runTool(tool, args);
  logToolEnd(input, result);

  yield { type: "tool_call", callId: toolCall.id, name: toolCall.function.name, arguments: args };
  yield { type: "tool_result", callId: toolCall.id, name: toolCall.function.name, result };
  appendToolResult(toolCall.id, toolCall.function.name, formatToolResultForModel(result));
}

async function runTool(
  tool: NonNullable<ReturnType<typeof getTool>>,
  parsedArgs: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    return await tool.execute(parsedArgs);
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}

function* emitToolParseError(
  context: SessionContext,
  turn: number,
  toolCall: ToolCall,
): Generator<AgentEvent> {
  const errorMessage = `工具参数 JSON 解析失败: ${toolCall.function.arguments}`;
  yield* emitToolFailure({ session: context, turn, toolCall, args: {}, errorMessage });
}

function* emitToolFailure(
  input: ToolExecutionContext & { errorMessage: string },
): Generator<AgentEvent> {
  logToolStart(input);
  logToolEnd(input, { success: false, error: input.errorMessage });
  yield { type: "tool_call", callId: input.toolCall.id, name: input.toolCall.function.name, arguments: input.args };
  yield {
    type: "tool_result",
    callId: input.toolCall.id,
    name: input.toolCall.function.name,
    result: { success: false, error: input.errorMessage },
  };
  appendToolResult(input.toolCall.id, input.toolCall.function.name, `错误: ${input.errorMessage}`);
}

function logToolStart(input: ToolExecutionContext): void {
  log("tool.start", {
    sessionId: input.session.sessionId,
    turn: input.turn,
    tool: input.toolCall.function.name,
    args: input.args,
  });
}

function logToolEnd(input: ToolExecutionContext, result: ToolResult): void {
  log("tool.end", {
    sessionId: input.session.sessionId,
    turn: input.turn,
    tool: input.toolCall.function.name,
    success: result.success,
    ...getToolFailureLog(result),
  });
}

function getToolFailureLog(result: ToolResult): Record<string, unknown> {
  if (result.success) return {};
  const metadata = result.metadata ?? {};
  return {
    error: result.error,
    exitCode: metadata.exitCode,
    timedOut: metadata.timedOut,
    signal: metadata.signal,
    shell: metadata.shell,
    truncated: metadata.truncated,
  };
}

function formatToolResultForModel(result: ToolResult): string {
  if (!result.metadata) {
    return result.success ? result.data ?? "成功" : `错误: ${result.error}`;
  }

  return JSON.stringify({
    success: result.success,
    data: result.data,
    error: result.error,
    metadata: result.metadata,
  }, null, 2);
}

function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
