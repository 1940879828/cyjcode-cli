import type { AgentHistoryStore } from "../agent/runtime.js";
import type { ChatMessage } from "../llm/types.js";
import type { SkillManager } from "../skills/index.js";

export interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  followUpMessages?: ChatMessage[];
  contextModifier?: (context: ToolExecuteContext) => ToolExecuteContext;
}

export interface ToolExecuteContext {
  sessionId: string;
  history: AgentHistoryStore;
  workspaceRoot: string;
  skillManager?: SkillManager;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context?: ToolExecuteContext): Promise<ToolResult> | ToolResult;
}
