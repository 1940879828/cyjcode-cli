import type { ToolResult } from "../tools/types.js";

/**
 * Agent 运行期间产出的所有事件，调用方通过 for await...of 逐事件消费。
 *
 * 生命周期:
 *   user_message → turn_start → [text_delta | (tool_call → tool_result)]* → turn_end → ... → done
 *
 *   - 纯文本回复: user_message → turn_start → text_delta* → turn_end → done
 *   - 工具调用场景: 可能经历多轮 turn，每轮 LLM 可能调用多个工具
 */
export type AgentEvent =
  | {
      /** 回显用户输入，总是第一个产出的事件 */
      type: "user_message";
      content: string;
    }
  | {
      /** DeepSeek 思考过程片段（reasoning_content），可选展示 */
      type: "reasoning_delta";
      content: string;
    }
  | {
      /** LLM 流式输出的文本片段（逐 token），UI 层可据此实现打字机效果 */
      type: "text_delta";
      content: string;
    }
  | {
      /** LLM 决定调用某个工具，携带工具名和已解析的参数对象 */
      type: "tool_call";
      callId: string;        // 本次工具调用的唯一标识，与 tool_result 一一对应
      name: string;          // 工具名，如 read_file、search_content 等
      arguments: Record<string, unknown>; // 已从 JSON 解析好的参数
    }
  | {
      /** 工具执行完成后返回的结果，与 tool_call 的 callId 对应 */
      type: "tool_result";
      callId: string;        // 对应 tool_call 的 id
      name: string;          // 工具名
      result: ToolResult;    // 包含 success 标记 + data 或 error
    }
  | {
      /** 新一轮思考开始，turn 从 1 递增，用于 UI 展示当前在"第几轮" */
      type: "turn_start";
      turn: number;
    }
  | {
      /** 当前轮次结束，本轮内可能已完成零个或多个 tool_call */
      type: "turn_end";
      turn: number;
    }
  | {
      /** Agent 整体运行完成，fullText 为最终汇总的完整回复文本 */
      type: "done";
      fullText: string;
    }
  | {
      /** 运行中发生错误（LLM 报错、工具超时、超过最大轮数等），通常之后不再有其他事件 */
      type: "error";
      error: string;
    };
