import type { Tool } from "./types.js";
import listDir from "./listDir.js";
import search from "./search.js";
import read from "./read.js";
import write from "./write.js";
import rename from "./rename.js";
import edit from "./edit.js";

export const allTools: Tool[] = [listDir, search, read, write, edit, rename];

const toolMap = new Map<string, Tool>();
for (const tool of allTools) {
  toolMap.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return toolMap.get(name);
}

/**
 * 将工具列表转换为 OpenAI function calling 所需的 tools 格式
 */
export function toolsToOpenAI(): Record<string, unknown>[] {
  return allTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export type { Tool, ToolResult } from "./types.js";
