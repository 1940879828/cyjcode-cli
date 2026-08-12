import { useState } from "react";
import { runAgentLoop } from "../../agent/loop.js";
import { clearHistory } from "../../agent/history.js";
import type { ToolResult } from "../../tools/types.js";
import { getRecordPath, recordAgentLoop, getMockPath, mockAgentLoop } from "../../devmock/index.js";
import {
  appendAssistantPart,
  appendAssistantTextDelta,
  createAssistantTurn,
  finalizeAssistantTurn,
  hasAssistantTurnContent,
} from "../assistantTurn.js";
import type { AssistantTurn } from "../assistantTurn.js";
import type { ContextUsageState } from "../contextUsage.js";
import { formatToolDisplay, formatToolErrorDisplay } from "../toolDisplay.js";

export interface ToolCallEntry {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEntry {
  callId: string;
  name: string;
  result: ToolResult;
}

export interface TextChatEntry {
  // 全局递增唯一 ID
  id: string;
  /**
   * 角色
   * system 系统级消息（如 /help 输出），不来自 LLM、用户输入
   * user 用户发送的问题
   * thinking 模型的推理过程
   * tool_call 工具执行摘要，不展示大段参数或结果
   * tool_result 保留给旧消息类型兼容
   * error 错误信息（LLM 报错、工具执行失败、超过轮数限制等）
   */
  role: "system" | "user" | "thinking" | "tool_call" | "tool_result" | "error";
  // 消息的文本内容
  content: string;
  // 仅内部兼容旧渲染路径；新工具摘要直接使用 content
  toolCall?: ToolCallEntry;
  // 仅 role === "tool_result" 时携带工具执行结果
  toolResult?: ToolResultEntry;
  // 消息创建时间戳
  timestamp: number;
}

/**
 * 单条消息。assistant 使用分组结构，按顺序容纳文本、工具摘要和错误。
 */
export type ChatEntry = TextChatEntry | AssistantTurn;

let entryCounter = 0;
const nextId = (): string => `msg_${++entryCounter}`;

/** 创建一条标准的 ChatEntry */
const makeEntry = (
  role: TextChatEntry["role"],
  content: string,
  extra?: Partial<Pick<TextChatEntry, "toolCall" | "toolResult">>,
): TextChatEntry => ({
  id: nextId(),
  role,
  content,
  timestamp: Date.now(),
  ...extra,
});

export function useChat() {
  /**
   * 历史记录 - 持久消息列表
   * 存已完成的消息（user、assistant turn 等），渲染时一次性画出
   */
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  /**
   * 实现 LLM 流式输出时的实时渲染
   * - 生成过程中的 thinking 和 assistant turn
   */
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingAssistantTurn, setStreamingAssistantTurn] = useState<AssistantTurn | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsageState>({
    status: "idle",
  });

  /** 追加一条消息到持久列表 */
  const append = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };

  /**
   * 事件消费器
   * 把 Agent 主循环产出的异步事件流，翻译成 UI 状态的更新。
   * @param text 
   */
  const consumeEvents = async (text: string) => {
    let reasoning = "";
    let currentAssistantTurn: AssistantTurn | null = null;
    const pendingToolCalls = new Map<string, ToolCallEntry>();
    const recordPath = getRecordPath();
    const mockPath = getMockPath();
    const generator = mockPath
      ? mockAgentLoop(text, mockPath)
      : recordPath
        ? recordAgentLoop(text, recordPath)
        : runAgentLoop(text);

    for await (const event of generator) {
      switch (event.type) {
        // 瞬态状态，实时打字效果 thinking
        case "reasoning_delta":
          reasoning += event.content;
          setStreamingReasoning(reasoning);
          break;

        // 瞬态状态，实时打字效果 ai回复
        case "text_delta":
          currentAssistantTurn = appendAssistantTextDelta(
            currentAssistantTurn ?? createAssistantTurn(nextId(), Date.now()),
            event.content,
          );
          setStreamingAssistantTurn(currentAssistantTurn);
          break;

        // 工具结果会携带更多 metadata，UI 等结果回来后只显示一行摘要。
        case "tool_call":
          pendingToolCalls.set(event.callId, {
            callId: event.callId,
            name: event.name,
            arguments: event.arguments,
          });
          break;

        // UI 只显示工具摘要，完整结果仍留在 agent history 里给模型使用。
        case "tool_result": {
          const toolCall = pendingToolCalls.get(event.callId) ?? {
            callId: event.callId,
            name: event.name,
            arguments: {},
          };
          pendingToolCalls.delete(event.callId);
          const context = {
            name: event.name,
            arguments: toolCall.arguments,
            result: event.result,
          };
          const content = event.result.success
            ? formatToolDisplay(context)
            : formatToolErrorDisplay(context);
          currentAssistantTurn = appendAssistantPart(
            currentAssistantTurn ?? createAssistantTurn(nextId(), Date.now()),
            nextId(),
            {
              id: nextId(),
              kind: event.result.success ? "tool" : "error",
              content,
            },
          );
          setStreamingAssistantTurn(currentAssistantTurn);
          break;
        }

        case "usage":
          setContextUsage({ status: "ready", usage: event.usage });
          break;

        // 流式结束，归档到 entries
        case "done":
          setContextUsage((current) =>
            current.status === "loading" ? { status: "error" } : current,
          );
          setStreamingReasoning("");
          if (reasoning) {
            append(makeEntry("thinking", reasoning));
          }
          currentAssistantTurn = finalizeAssistantTurn(
            currentAssistantTurn ?? createAssistantTurn(nextId(), Date.now()),
            nextId(),
            event.fullText || "（无回复内容）",
          );
          append(currentAssistantTurn);
          currentAssistantTurn = null;
          setStreamingAssistantTurn(null);
          break;

        case "error":
          if (currentAssistantTurn && hasAssistantTurnContent(currentAssistantTurn)) {
            currentAssistantTurn = appendAssistantPart(
              currentAssistantTurn,
              nextId(),
              {
                id: nextId(),
                kind: "error",
                content: `错误: ${event.error}`,
              },
            );
            append(currentAssistantTurn);
            currentAssistantTurn = null;
            setStreamingAssistantTurn(null);
          } else {
            append(makeEntry("error", `错误: ${event.error}`));
          }
          setContextUsage((current) =>
            current.status === "loading" ? { status: "error" } : current,
          );
          break;
      }
    }
  };

  const sendMessage = async (text: string) => {
    if (isStreaming || !text.trim()) return;

    // 用户消息加入列表
    append(makeEntry("user", text));
    // 锁定输入框
    setIsStreaming(true);
    setStreamingReasoning("");
    setStreamingAssistantTurn(null);
    setContextUsage({ status: "loading" });

    try {
      // 执行对话循环
      await consumeEvents(text);
    } catch (err) {
      append(makeEntry("error", `错误: ${err instanceof Error ? err.message : String(err)}`));
      setContextUsage((current) =>
        current.status === "loading" ? { status: "error" } : current,
      );
    } finally {
      setIsStreaming(false);
      setStreamingReasoning("");
      setStreamingAssistantTurn(null);
    }
  };

  // 清空历史
  const clearChat = () => {
    setEntries([]);
    clearHistory();
    setStreamingAssistantTurn(null);
    setContextUsage({ status: "idle" });
  };

  const appendSystemMessage = (content: string) => {
    append(makeEntry("system", content));
  };

  return {
    entries,
    isStreaming,
    streamingAssistantTurn,
    streamingReasoning,
    contextUsage,
    sendMessage,
    clearChat,
    appendSystemMessage,
  };
}
