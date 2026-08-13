import type { AssistantTurn } from "./assistantTurn.js";
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

export interface TextChatEntry {
  id: string;
  role: "system" | "user" | "thinking" | "tool_call" | "tool_result" | "error";
  content: string;
  toolCall?: ToolCallEntry;
  toolResult?: ToolResultEntry;
  timestamp: number;
}

export type ChatEntry = TextChatEntry | AssistantTurn;
