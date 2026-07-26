import type { ToolResult } from "../tools/types.js";

export type AgentEvent =
  | { type: "user_message"; content: string }
  | { type: "text_delta"; content: string }
  | { type: "tool_call"; callId: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; callId: string; name: string; result: ToolResult }
  | { type: "turn_start"; turn: number }
  | { type: "turn_end"; turn: number }
  | { type: "done"; fullText: string }
  | { type: "error"; error: string };
