import type { ChatMessage } from "../llm/types.js";

const messages: ChatMessage[] = [];

export function addMessage(msg: ChatMessage): void {
  messages.push(msg);
}

export function getMessages(): ChatMessage[] {
  return [...messages];
}

export function getHistoryLength(): number {
  return messages.length;
}

export function isHistoryEmpty(): boolean {
  return messages.length === 0;
}

export function appendToolResult(
  toolCallId: string,
  toolName: string,
  result: string
): void {
  messages.push({
    role: "tool",
    content: result,
    tool_call_id: toolCallId,
    name: toolName,
  });
}

export function clearHistory(): void {
  messages.length = 0;
}

export function truncateHistory(length: number): void {
  messages.length = Math.max(0, Math.min(length, messages.length));
}
