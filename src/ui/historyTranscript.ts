import type { ChatMessage } from "../llm/types.js";
import { createAssistantTurn, finalizeAssistantTurn } from "./assistantTurn.js";
import type { ChatEntry, TextChatEntry } from "./chatTypes.js";

export interface HistoryTranscriptOptions {
  nextId: () => string;
  now: () => number;
}

export function messagesToChatEntries(
  messages: ChatMessage[],
  options: HistoryTranscriptOptions,
): ChatEntry[] {
  return messages
    .map((message) => messageToEntry(message, options))
    .filter((entry): entry is ChatEntry => entry !== null);
}

export function assistantMessageContent(message: ChatMessage): string {
  if (message.content) return message.content;
  const names = message.tool_calls?.map((call) => call.function.name).join(", ");
  return names ? `工具调用: ${names}` : "（无回复内容）";
}

function messageToEntry(
  message: ChatMessage,
  options: HistoryTranscriptOptions,
): ChatEntry | null {
  if (message.role === "assistant") return assistantMessageToEntry(message, options);
  if (message.role === "tool") return textEntry("tool_result", message.content ?? "", options);
  if (message.role === "user" || message.role === "system") {
    return textEntry(message.role, message.content ?? "", options);
  }
  return null;
}

function assistantMessageToEntry(
  message: ChatMessage,
  options: HistoryTranscriptOptions,
): ChatEntry {
  const content = assistantMessageContent(message);
  return finalizeAssistantTurn(
    createAssistantTurn(options.nextId(), options.now()),
    options.nextId(),
    content,
  );
}

function textEntry(
  role: TextChatEntry["role"],
  content: string,
  options: HistoryTranscriptOptions,
): TextChatEntry {
  return {
    id: options.nextId(),
    role,
    content,
    timestamp: options.now(),
  };
}
