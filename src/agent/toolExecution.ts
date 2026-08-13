import type { ToolCall } from "../llm/types.js";
import { getTool } from "../tools/index.js";
import type { ToolResult } from "../tools/types.js";
import { log } from "../utils/logger.js";
import type { AgentEvent } from "./types.js";
import { toErrorMessage } from "./errors.js";
import type { AgentHistoryStore } from "./runtime.js";

interface ToolExecutionContext {
  sessionId: string;
  turn: number;
  toolCall: ToolCall;
  args: Record<string, unknown>;
  history: AgentHistoryStore;
}

export async function* executeToolCalls({
  sessionId,
  turn,
  toolCalls,
  history,
}: {
  sessionId: string;
  turn: number;
  toolCalls: ToolCall[];
  history: AgentHistoryStore;
}): AsyncGenerator<AgentEvent> {
  for (const toolCall of toolCalls) {
    const parsedArgs = parseToolArgs(toolCall.function.arguments);
    if (!parsedArgs) {
      yield* emitToolParseError({ sessionId, turn, toolCall, args: {}, history });
      continue;
    }
    yield* emitToolExecution({ sessionId, turn, toolCall, args: parsedArgs, history });
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
  rememberToolResult(input, formatToolResultForModel(result));
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

function* emitToolParseError(input: ToolExecutionContext): Generator<AgentEvent> {
  yield* emitToolFailure({
    ...input,
    errorMessage: `工具参数 JSON 解析失败: ${input.toolCall.function.arguments}`,
  });
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
  rememberToolResult(input, `错误: ${input.errorMessage}`);
}

function rememberToolResult(input: ToolExecutionContext, content: string): void {
  input.history.addMessage({
    role: "tool",
    content,
    tool_call_id: input.toolCall.id,
    name: input.toolCall.function.name,
  });
}

function logToolStart(input: ToolExecutionContext): void {
  log("tool.start", {
    sessionId: input.sessionId,
    turn: input.turn,
    tool: input.toolCall.function.name,
    args: input.args,
  });
}

function logToolEnd(input: ToolExecutionContext, result: ToolResult): void {
  log("tool.end", {
    sessionId: input.sessionId,
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
