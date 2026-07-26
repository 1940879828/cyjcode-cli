import { useState, useCallback, useRef } from "react";
import { runAgentLoop } from "../agent/loop.js";
import { clearHistory } from "../agent/history.js";
import type { ToolResult } from "../tools/types.js";

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

export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "tool_call" | "tool_result" | "error";
  content: string;
  toolCall?: ToolCallEntry;
  toolResult?: ToolResultEntry;
  timestamp: number;
}

let entryId = 0;
function nextId(): string {
  return `msg_${++entryId}`;
}

export function useChat() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (isStreaming) return;
    if (!text.trim()) return;

    // 添加用户消息
    const userEntry: ChatEntry = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setEntries((prev) => [...prev, userEntry]);

    setIsStreaming(true);
    setStreamingText("");

    let currentStreamingText = "";

    try {
      const loop = runAgentLoop(text);

      for await (const event of loop) {
        switch (event.type) {
          case "text_delta":
            currentStreamingText += event.content;
            setStreamingText(currentStreamingText);
            break;

          case "tool_call": {
            const tcEntry: ChatEntry = {
              id: nextId(),
              role: "tool_call",
              content: `调用工具: ${event.name}`,
              toolCall: {
                callId: event.callId,
                name: event.name,
                arguments: event.arguments,
              },
              timestamp: Date.now(),
            };
            setEntries((prev) => [...prev, tcEntry]);
            break;
          }

          case "tool_result": {
            const trEntry: ChatEntry = {
              id: nextId(),
              role: "tool_result",
              content: event.result.success
                ? event.result.data || "成功"
                : `错误: ${event.result.error}`,
              toolResult: {
                callId: event.callId,
                name: event.name,
                result: event.result,
              },
              timestamp: Date.now(),
            };
            setEntries((prev) => [...prev, trEntry]);
            break;
          }

          case "done": {
            const assistantEntry: ChatEntry = {
              id: nextId(),
              role: "assistant",
              content: event.fullText || currentStreamingText,
              timestamp: Date.now(),
            };
            setStreamingText("");
            setEntries((prev) => [...prev, assistantEntry]);
            break;
          }

          case "error": {
            const errorEntry: ChatEntry = {
              id: nextId(),
              role: "error",
              content: `错误: ${event.error}`,
              timestamp: Date.now(),
            };
            setEntries((prev) => [...prev, errorEntry]);
            break;
          }
        }
      }
    } catch (err) {
      const errorEntry: ChatEntry = {
        id: nextId(),
        role: "error",
        content: `错误: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      setEntries((prev) => [...prev, errorEntry]);
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  }, [isStreaming]);

  const clearChat = useCallback(() => {
    setEntries([]);
    clearHistory();
  }, []);

  return {
    entries,
    isStreaming,
    streamingText,
    sendMessage,
    clearChat,
  };
}
