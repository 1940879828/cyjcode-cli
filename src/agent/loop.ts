import { streamChat } from "../llm/client.js";
import type { ChatMessage, TokenUsage, ToolCall } from "../llm/types.js";
import { toolsToOpenAI, getTool } from "../tools/index.js";
import type { ToolResult } from "../tools/types.js";
import type { AgentEvent } from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import { addMessage, getMessages, appendToolResult } from "./history.js";
import { log } from "../utils/logger.js";

const MAX_ROUNDS = 10;

// ─── 内部辅助 ────────────────────────────────────────

/** 生成简短的会话 ID */
function generateSessionId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 产出工具错误事件（tool_call + tool_result）并写入历史 */
function* emitToolError(
  tc: ToolCall,
  errorMessage: string,
): Generator<AgentEvent> {
  yield {
    type: "tool_call",
    callId: tc.id,
    name: tc.function.name,
    arguments: {},
  };
  yield {
    type: "tool_result",
    callId: tc.id,
    name: tc.function.name,
    result: { success: false, error: errorMessage },
  };
  appendToolResult(tc.id, tc.function.name, `错误: ${errorMessage}`);
}

/** 执行单个工具调用，返回需 yield 的事件序列 */
async function* emitToolExecution(
  tc: ToolCall,
  parsedArgs: Record<string, unknown>,
  sessionId: string,
  turn: number,
): AsyncGenerator<AgentEvent> {
  const tool = getTool(tc.function.name);
  if (!tool) {
    log("tool.start", { sessionId, turn, tool: tc.function.name, args: parsedArgs });
    log("tool.end", { sessionId, turn, tool: tc.function.name, success: false, error: "未注册的工具" });
    yield* emitToolError(tc, `未注册的工具: ${tc.function.name}`);
    return;
  }

  // 埋点: tool.start
  log("tool.start", { sessionId, turn, tool: tc.function.name, args: parsedArgs });

  let result: ToolResult;
  try {
    result = await tool.execute(parsedArgs);
  } catch (err) {
    result = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // 埋点: tool.end
  log("tool.end", {
    sessionId,
    turn,
    tool: tc.function.name,
    success: result.success,
    error: result.success ? undefined : result.error,
  });

  yield { type: "tool_call", callId: tc.id, name: tc.function.name, arguments: parsedArgs };
  yield { type: "tool_result", callId: tc.id, name: tc.function.name, result };

  const resultStr = formatToolResultForModel(result);
  appendToolResult(tc.id, tc.function.name, resultStr);
}

function formatToolResultForModel(result: ToolResult): string {
  if (!result.metadata) {
    return result.success ? result.data ?? "成功" : `错误: ${result.error}`;
  }

  return JSON.stringify(
    {
      success: result.success,
      data: result.data,
      error: result.error,
      metadata: result.metadata,
    },
    null,
    2,
  );
}

/** 尝试解析工具参数，失败返回 null */
function parseToolArgs(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── 主循环 ──────────────────────────────────────────

/**
 * Agent 主循环: AsyncGenerator 逐事件产出。
 * 调用方通过 for await...of 消费事件流。
 */
export async function* runAgentLoop(
  userMessage: string,
): AsyncGenerator<AgentEvent> {
  const sessionId = generateSessionId();

  // 埋点: session.start
  log("session.start", { sessionId, userMessage });

  // 回显并记录用户输入
  yield { type: "user_message", content: userMessage };
  addMessage({ role: "user", content: userMessage });

  const systemPrompt = buildSystemPrompt();
  const tools = toolsToOpenAI();

  for (let turn = 1; turn <= MAX_ROUNDS; turn++) {
    yield { type: "turn_start", turn };

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...getMessages(),
    ];

    // 埋点: llm.request
    log("llm.request", {
      sessionId,
      turn,
      messageCount: messages.length,
    });

    let fullText = "";
    let reasoningText = "";
    let toolCalls: ToolCall[] | null = null;
    let usage: TokenUsage | null = null;

    try {
      const stream = streamChat({ messages, tools });

      for await (const event of stream) {
        switch (event.type) {
          case "reasoning_delta":
            reasoningText += event.content;
            yield { type: "reasoning_delta", content: event.content };
            break;

          case "text_delta":
            fullText += event.content;
            yield { type: "text_delta", content: event.content };
            break;

          case "tool_call_delta":
            // 增量在 done 事件中统一处理
            break;

          case "usage":
            usage = event.usage;
            yield { type: "usage", usage };
            break;

          case "done": {
            const tcList = event.message.tool_calls;
            if (tcList?.length) {
              toolCalls = tcList;
            }
            log("llm.response", {
              sessionId,
              turn,
              hasToolCalls: !!toolCalls,
              toolCallCount: toolCalls?.length ?? 0,
              responseLength: fullText.length,
              promptTokens: usage?.promptTokens,
              completionTokens: usage?.completionTokens,
              totalTokens: usage?.totalTokens,
            });
            break;
          }

          case "error":
            log("error", { sessionId, turn, message: event.error.message });
            yield { type: "error", error: event.error.message };
            yield { type: "turn_end", turn };
            log("session.end", { sessionId, status: "error", totalTurns: turn });
            return;
        }
      }

      // 无工具调用 → 本轮即最终回复
      if (!toolCalls) {
        addMessage({
          role: "assistant",
          content: fullText || "（无回复内容）",
        });
        yield { type: "turn_end", turn };
        yield { type: "done", fullText: fullText || "（无回复内容）" };
        log("session.end", { sessionId, status: "success", totalTurns: turn });
        return;
      }

      // 有工具调用 → 保存助手消息，逐条执行工具
      addMessage({
        role: "assistant",
        content: fullText || null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        const parsedArgs = parseToolArgs(tc.function.arguments);

        if (!parsedArgs) {
          log("tool.start", {
            sessionId,
            turn,
            tool: tc.function.name,
            args: tc.function.arguments,
          });
          log("tool.end", {
            sessionId,
            turn,
            tool: tc.function.name,
            success: false,
            error: "JSON 解析失败",
          });
          yield* emitToolError(
            tc,
            `工具参数 JSON 解析失败: ${tc.function.arguments}`,
          );
          continue;
        }

        yield* emitToolExecution(tc, parsedArgs, sessionId, turn);
      }

      yield { type: "turn_end", turn };
    } catch (error) {
      log("error", {
        sessionId,
        turn,
        message: error instanceof Error ? error.message : String(error),
      });
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      yield { type: "turn_end", turn };
      log("session.end", { sessionId, status: "error", totalTurns: turn });
      return;
    }
  }

  // 超过 MAX_ROUNDS
  log("error", { sessionId, message: `达到最大轮数限制 (${MAX_ROUNDS})` });
  log("session.end", { sessionId, status: "max_rounds", totalTurns: MAX_ROUNDS });
  yield {
    type: "error",
    error: `已达到最大工具调用轮数 (${MAX_ROUNDS})，终止循环`,
  };
}
