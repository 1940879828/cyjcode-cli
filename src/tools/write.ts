import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const write: Tool = {
  name: "write",
  description:
    "将内容写入（创建或覆盖）指定文件。仅在当前工作目录下允许写入。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "要写入的文件路径，相对于当前工作目录",
      },
      content: {
        type: "string",
        description: "要写入的文件内容",
      },
    },
    required: ["filePath", "content"],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const parsed = parseWriteArgs(args);

    if (!parsed.success) return { success: false, error: parsed.error };

    try {
      return writeFile(parsed.value);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

interface WriteArgs {
  filePath: string;
  content: string;
  resolvedPath: string;
}

function parseWriteArgs(
  args: Record<string, unknown>,
): { success: true; value: WriteArgs } | { success: false; error: string } {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";

  if (!filePath) return { success: false, error: "filePath 参数不能为空" };
  const content = parseWriteContent(args.content);
  if (!content.success) return content;

  const resolved = resolveInsideWorkspace(filePath);
  if (!resolved.success) return resolved;

  return {
    success: true,
    value: { filePath, content: content.value, resolvedPath: resolved.path },
  };
}

function parseWriteContent(
  content: unknown,
): { success: true; value: string } | { success: false; error: string } {
  if (content === undefined || content === null) {
    return { success: false, error: "content 参数不能为空" };
  }
  if (typeof content !== "string") {
    return { success: false, error: "content 参数必须是字符串" };
  }
  return { success: true, value: content };
}

function writeFile(args: WriteArgs): ToolResult {
  const dir = path.dirname(args.resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(args.resolvedPath, args.content, "utf-8");
  const size = Buffer.byteLength(args.content, "utf-8");
  return {
    success: true,
    data: `成功写入 ${args.filePath} (${size} 字节)`,
  };
}

export default write;
