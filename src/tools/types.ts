import type { z } from "zod";

export interface ToolResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}
