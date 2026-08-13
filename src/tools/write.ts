import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./defineTool.js";
import type { ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const writeArgsSchema = z.object({
  filePath: z.string().min(1, "filePath 参数不能为空")
    .describe("要写入的文件路径，相对于当前工作目录"),
  content: z.string({
    error: (issue) => issue.input === undefined || issue.input === null
      ? "content 参数不能为空"
      : "content 参数必须是字符串",
  }).describe("要写入的文件内容"),
});

const write = defineTool({
  name: "write",
  description:
    "将内容写入（创建或覆盖）指定文件。仅在当前工作目录下允许写入。",
  schema: writeArgsSchema,
  execute(args): ToolResult {
    const resolved = resolveInsideWorkspace(args.filePath);
    if (!resolved.success) return { success: false, error: resolved.error };
    try {
      return writeFile({ ...args, resolvedPath: resolved.path });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

interface WriteArgs {
  filePath: string;
  content: string;
  resolvedPath: string;
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
