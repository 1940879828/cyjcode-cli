import type { ChatMessage, ToolCall } from "../llm/types.js";
import { getTool } from "../tools/index.js";
import type { ToolResult } from "../tools/types.js";
import { log } from "../utils/logger.js";
import type { AgentEvent } from "./types.js";
import { toErrorMessage } from "./errors.js";
import type { AgentHistoryStore } from "./runtime.js";
import type { SkillManager } from "../skills/index.js";

interface ToolExecutionContext {
  sessionId: string;
  turn: number;
  toolCall: ToolCall;
  args: Record<string, unknown>;
  history: AgentHistoryStore;
  workspaceRoot: string;
  skillManager?: SkillManager;
}

export interface ToolExecutionBatch {
  sessionId: string;
  turn: number;
  toolCalls: ToolCall[];
  history: AgentHistoryStore;
  workspaceRoot: string;
  skillManager?: SkillManager;
}

export async function* executeToolCalls(input: ToolExecutionBatch): AsyncGenerator<AgentEvent> {
  let currentBatch = input;
  const followUpMessages: ChatMessage[] = [];
  for (const toolCall of input.toolCalls) {
    const parsedArgs = parseToolArgs(toolCall.function.arguments);
    if (!parsedArgs) {
      yield* emitToolParseError(createToolContext(currentBatch, toolCall, {}));
      continue;
    }
    const result = yield* emitToolExecution(createToolContext(currentBatch, toolCall, parsedArgs));
    if (!result) continue;
    followUpMessages.push(...validFollowUpMessages(result));
    currentBatch = applyContextModifier(currentBatch, result);
  }
  rememberFollowUpMessages(input.history, followUpMessages);
}

function createToolContext(
  input: ToolExecutionBatch,
  toolCall: ToolCall,
  args: Record<string, unknown>,
): ToolExecutionContext {
  return { ...input, toolCall, args };
}

async function* emitToolExecution(input: ToolExecutionContext): AsyncGenerator<AgentEvent, ToolResult | undefined> {
  const { toolCall, args } = input;
  const tool = getTool(toolCall.function.name);
  if (!tool) {
    yield* emitToolFailure({ ...input, errorMessage: "未注册的工具" });
    return;
  }

  logToolStart(input);
  const result = await runTool(tool, args, input);
  logToolEnd(input, result);

  yield { type: "tool_call", callId: toolCall.id, name: toolCall.function.name, arguments: args };
  const publicResult = toPublicToolResult(result);
  yield { type: "tool_result", callId: toolCall.id, name: toolCall.function.name, result: publicResult };
  rememberToolResult(input, formatToolResultForModel(publicResult));
  return result;
}

async function runTool(
  tool: NonNullable<ReturnType<typeof getTool>>,
  parsedArgs: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  try {
    return await tool.execute(parsedArgs, {
      sessionId: context.sessionId,
      history: context.history,
      workspaceRoot: context.workspaceRoot,
      skillManager: context.skillManager,
    });
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

function toPublicToolResult(result: ToolResult): ToolResult {
  return {
    success: result.success,
    data: result.data,
    error: result.error,
    metadata: result.metadata,
  };
}

function rememberFollowUpMessages(history: AgentHistoryStore, messages: ChatMessage[]): void {
  for (const message of messages) {
    history.addMessage(message);
  }
}

function validFollowUpMessages(result: ToolResult): ChatMessage[] {
  const messages = Array.isArray(result.followUpMessages) ? result.followUpMessages : [];
  return messages.filter(isHistoryMessage);
}

function isHistoryMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const role = (value as { role?: unknown }).role;
  return role === "system" || role === "user" || role === "assistant" || role === "tool";
}

function applyContextModifier(input: ToolExecutionBatch, result: ToolResult): ToolExecutionBatch {
  if (!result.contextModifier) return input;
  const next = result.contextModifier({
    sessionId: input.sessionId,
    history: input.history,
    workspaceRoot: input.workspaceRoot,
    skillManager: input.skillManager,
  });
  return {
    ...input,
    history: next.history,
    workspaceRoot: next.workspaceRoot,
    skillManager: next.skillManager,
  };
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
