import { useState } from "react";
import { runAgentLoop } from "../../agent/loop.js";
import { clearHistory } from "../../agent/history.js";
import type { ToolResult } from "../../tools/types.js";
import { getRecordPath, recordAgentLoop, getMockPath, mockAgentLoop } from "../../devmock/index.js";

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
  role: "system" | "user" | "assistant" | "thinking" | "tool_call" | "tool_result" | "error";
  content: string;
  toolCall?: ToolCallEntry;
  toolResult?: ToolResultEntry;
  timestamp: number;
}

let entryCounter = 0;
const nextId = (): string => `msg_${++entryCounter}`;

/** 创建一条标准的 ChatEntry */
const makeEntry = (
  role: ChatEntry["role"],
  content: string,
  extra?: Partial<Pick<ChatEntry, "toolCall" | "toolResult">>,
): ChatEntry => ({
  id: nextId(),
  role,
  content,
  timestamp: Date.now(),
  ...extra,
});

export function useChat() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");

  const append = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };

  const consumeEvents = async (text: string) => {
    let buffer = "";
    let reasoning = "";
    const recordPath = getRecordPath();
    const mockPath = getMockPath();
    const generator = mockPath
      ? mockAgentLoop(text, mockPath)
      : recordPath
        ? recordAgentLoop(text, recordPath)
        : runAgentLoop(text);

    for await (const event of generator) {
      switch (event.type) {
        case "reasoning_delta":
          reasoning += event.content;
          setStreamingReasoning(reasoning);
          break;

        case "text_delta":
          buffer += event.content;
          setStreamingText(buffer);
          break;

        case "tool_call":
          append(
            makeEntry("tool_call", `调用工具: ${event.name}`, {
              toolCall: { callId: event.callId, name: event.name, arguments: event.arguments },
            }),
          );
          break;

        case "tool_result":
          append(
            makeEntry(
              "tool_result",
              event.result.success ? event.result.data || "成功" : `错误: ${event.result.error}`,
              { toolResult: { callId: event.callId, name: event.name, result: event.result } },
            ),
          );
          break;

        case "done":
          setStreamingReasoning("");
          if (reasoning) {
            append(makeEntry("thinking", reasoning));
          }
          append(makeEntry("assistant", event.fullText || buffer));
          setStreamingText("");
          break;

        case "error":
          append(makeEntry("error", `错误: ${event.error}`));
          break;
      }
    }
  };

  const sendMessage = async (text: string) => {
    if (isStreaming || !text.trim()) return;

    append(makeEntry("user", text));
    setIsStreaming(true);
    setStreamingText("");
    setStreamingReasoning("");

    try {
      await consumeEvents(text);
    } catch (err) {
      append(makeEntry("error", `错误: ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      setIsStreaming(false);
      setStreamingText("");
      setStreamingReasoning("");
    }
  };

  const clearChat = () => {
    setEntries([]);
    clearHistory();
  };

  const appendSystemMessage = (content: string) => {
    append(makeEntry("system", content));
  };

  return {
    entries,
    isStreaming,
    streamingText,
    streamingReasoning,
    sendMessage,
    clearChat,
    appendSystemMessage,
  };
}
