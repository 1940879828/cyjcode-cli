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

const MAX_ROUNDS = 10;
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

export async function* runAgentLoop(
  userMessage: string,
): AsyncGenerator<AgentEvent> {
  const context = startSession(userMessage);

  yield { type: "user_message", content: userMessage };
  addMessage({ role: "user", content: userMessage });

  for (let turn = 1; turn <= MAX_ROUNDS; turn++) {
    yield { type: "turn_start", turn };

    try {
      const response = yield* emitLlmTurn(context, turn);
      if (!response.toolCalls) {
        yield* finishTextResponse(context, turn, response.fullText);
        return;
      }

      addAssistantToolRequest(response);
      yield* executeToolCalls(context, turn, response.toolCalls);
      yield { type: "turn_end", turn };
    } catch (error) {
      yield* finishWithError(context, turn, toErrorMessage(error));
      return;
    }
  }

  yield* finishMaxRounds(context);
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
      response.fullText += event.content;
      return { type: "text_delta", content: event.content };
    case "usage":
      response.usage = event.usage;
      return { type: "usage", usage: event.usage };
    case "done":
      response.toolCalls = event.message.tool_calls?.length
        ? event.message.tool_calls
        : null;
      return null;
    case "tool_call_delta":
      return null;
    case "error":
      throw event.error;
  }
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
    yield* emitToolExecution(context, turn, toolCall, parsedArgs);
  }
}

async function* emitToolExecution(
  context: SessionContext,
  turn: number,
  toolCall: ToolCall,
  parsedArgs: Record<string, unknown>,
): AsyncGenerator<AgentEvent> {
  const tool = getTool(toolCall.function.name);
  if (!tool) {
    yield* emitToolFailure(context, turn, toolCall, parsedArgs, "未注册的工具");
    return;
  }

  logToolStart(context, turn, toolCall.function.name, parsedArgs);
  const result = await runTool(tool, parsedArgs);
  logToolEnd(context, turn, toolCall.function.name, result);

  yield { type: "tool_call", callId: toolCall.id, name: toolCall.function.name, arguments: parsedArgs };
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
  yield* emitToolFailure(context, turn, toolCall, {}, errorMessage);
}

function* emitToolFailure(
  context: SessionContext,
  turn: number,
  toolCall: ToolCall,
  parsedArgs: Record<string, unknown>,
  errorMessage: string,
): Generator<AgentEvent> {
  logToolStart(context, turn, toolCall.function.name, parsedArgs);
  logToolEnd(context, turn, toolCall.function.name, { success: false, error: errorMessage });
  yield { type: "tool_call", callId: toolCall.id, name: toolCall.function.name, arguments: parsedArgs };
  yield {
    type: "tool_result",
    callId: toolCall.id,
    name: toolCall.function.name,
    result: { success: false, error: errorMessage },
  };
  appendToolResult(toolCall.id, toolCall.function.name, `错误: ${errorMessage}`);
}

function logToolStart(
  context: SessionContext,
  turn: number,
  toolName: string,
  args: Record<string, unknown>,
): void {
  log("tool.start", { sessionId: context.sessionId, turn, tool: toolName, args });
}

function logToolEnd(
  context: SessionContext,
  turn: number,
  toolName: string,
  result: ToolResult,
): void {
  log("tool.end", {
    sessionId: context.sessionId,
    turn,
    tool: toolName,
    success: result.success,
    error: result.success ? undefined : result.error,
  });
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
