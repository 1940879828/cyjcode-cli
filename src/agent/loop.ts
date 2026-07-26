import { streamChat } from "../llm/client.js";
import type { ChatMessage } from "../llm/types.js";
import { toolsToOpenAI, getTool } from "../tools/index.js";
import type { AgentEvent } from "./types.js";
import { buildSystemPrompt } from "./prompt.js";
import { addMessage, getMessages, appendToolResult } from "./history.js";
import { log } from "../utils/logger.js";

const MAX_ROUNDS = 10;

/**
 * Agent 主循环: AsyncGenerator 逐事件产出。
 * 调用方通过 for await...of 消费事件流。
 */
export async function* runAgentLoop(
  userMessage: string
): AsyncGenerator<AgentEvent> {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 埋点: session.start
  log("session.start", { sessionId, userMessage });

  // 1. yield user_message 事件
  yield { type: "user_message", content: userMessage };

  // 2. 将用户消息加入历史
  addMessage({ role: "user", content: userMessage });

  // 3. 构建 system prompt（首次）
  const systemPrompt = buildSystemPrompt();

  // 4. 主循环
  const tools = toolsToOpenAI();
  let totalTokens = 0;

  for (let turn = 1; turn <= MAX_ROUNDS; turn++) {
    yield { type: "turn_start", turn };

    // 构建消息列表
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...getMessages(),
    ];

    // 埋点: llm.request
    log("llm.request", {
      sessionId,
      turn,
      model: systemPrompt, // 实际 model 在 client 中读取
      messageCount: messages.length,
    });

    // 调用 LLM
    let fullText = "";
    let hasToolCalls = false;
    let doneToolCalls: ChatMessage["tool_calls"] = [];

    try {
      const stream = streamChat({ messages, tools });

      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            fullText += event.content;
            yield { type: "text_delta", content: event.content };
            break;

          case "tool_call_delta":
            // 累积 tool_call 原始增量（不逐个 yield，等 done 时一起处理）
            break;

          case "done": {
            const msg = event.message;
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              hasToolCalls = true;
              doneToolCalls = msg.tool_calls;
            }
            // 埋点: llm.response
            log("llm.response", {
              sessionId,
              turn,
              hasToolCalls,
              toolCallCount: doneToolCalls?.length || 0,
              responseLength: fullText.length,
              totalTokens,
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

      // 如果本轮有文本输出且无 tool_calls，保存助手消息并完成
      if (fullText && !hasToolCalls) {
        addMessage({ role: "assistant", content: fullText });
        yield { type: "turn_end", turn };
        yield { type: "done", fullText };
        log("session.end", { sessionId, status: "success", totalTurns: turn, totalTokens });
        return;
      }

      // 如果本轮没有 tool_calls 也没有文本（异常情况），退出
      if (!hasToolCalls) {
        yield { type: "turn_end", turn };
        yield { type: "done", fullText: fullText || "（无回复内容）" };
        log("session.end", { sessionId, status: "success", totalTurns: turn, totalTokens });
        return;
      }

      // 处理 tool_calls
      // 保存助手消息（带 tool_calls）
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: fullText || null,
        tool_calls: doneToolCalls,
      };
      addMessage(assistantMsg);

      // 执行每个工具调用
      for (const tc of doneToolCalls) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(tc.function.arguments);
        } catch {
          log("tool.start", { sessionId, turn, tool: tc.function.name, args: tc.function.arguments });
          log("tool.end", { sessionId, turn, tool: tc.function.name, success: false, error: "JSON 解析失败" });
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
            result: {
              success: false,
              error: `工具参数 JSON 解析失败: ${tc.function.arguments}`,
            },
          };
          appendToolResult(
            tc.id,
            tc.function.name,
            `错误: 工具参数 JSON 解析失败: ${tc.function.arguments}`
          );
          continue;
        }

        yield {
          type: "tool_call",
          callId: tc.id,
          name: tc.function.name,
          arguments: parsedArgs,
        };

        // 执行工具
        const tool = getTool(tc.function.name);
        if (!tool) {
          log("tool.start", { sessionId, turn, tool: tc.function.name, args: parsedArgs });
          log("tool.end", { sessionId, turn, tool: tc.function.name, success: false, error: "未注册的工具" });
          const errorResult = {
            success: false,
            error: `未注册的工具: ${tc.function.name}`,
          };
          yield {
            type: "tool_result",
            callId: tc.id,
            name: tc.function.name,
            result: errorResult,
          };
          appendToolResult(
            tc.id,
            tc.function.name,
            `错误: 未注册的工具: ${tc.function.name}`
          );
          continue;
        }

        // 埋点: tool.start
        log("tool.start", { sessionId, turn, tool: tc.function.name, args: parsedArgs });

        let result;
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

        yield {
          type: "tool_result",
          callId: tc.id,
          name: tc.function.name,
          result,
        };

        // 将工具结果追加到消息历史
        const resultStr = result.success
          ? result.data ?? "成功"
          : `错误: ${result.error}`;
        appendToolResult(tc.id, tc.function.name, resultStr);
      }

      yield { type: "turn_end", turn };
      // 继续下一轮
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
