import type { ToolResult } from "../tools/types.js";
import type { TokenUsage, ToolCallDelta } from "../llm/types.js";
import type { ObservationStats } from "./observation.js";

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionItem {
  question: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

/**
 * Agent 运行期间产出的所有事件，调用方通过 for await...of 逐事件消费。
 *
 * 生命周期:
 *   user_message → turn_start → [text_delta | tool_call_delta | (tool_call → tool_result)]* → turn_end → ... → done
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
      /** LLM 正在构造工具调用，参数可能还不是完整 JSON；UI 默认可忽略 */
      type: "tool_call_delta";
      deltas: ToolCallDelta[];
    }
  | {
      /** 工具即将执行，携带工具名和已解析的完整参数对象 */
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
      /** 工具请求暂停并等待用户回答 */
      type: "await_user_input";
      callId: string;
      questions: AskUserQuestionItem[];
    }
  | {
      /** 本轮 API 返回的真实 token 用量，promptTokens 表示上下文输入占用 */
      type: "usage";
      usage: TokenUsage;
    }
  | {
      /** 新一轮思考开始，turn 从 1 递增，用于 UI 展示当前在"第几轮" */
      type: "turn_start";
      turn: number;
    }
  | {
      /** 正在把完整历史投影成更短的模型观测上下文 */
      type: "context_compression_start";
      turn: number;
    }
  | {
      /** 上下文观测压缩完成，随后进入 LLM 请求 */
      type: "context_compression_end";
      turn: number;
      stats: ObservationStats;
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
