import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./defineTool.js";
import type { ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const renameArgsSchema = z.object({
  oldPath: z.string().min(1, "oldPath 参数不能为空")
    .describe("原文件路径，相对于当前工作目录"),
  newPath: z.string().min(1, "newPath 参数不能为空")
    .describe("新文件路径，相对于当前工作目录"),
});

const rename = defineTool({
  name: "rename",
  description:
    "重命名或移动文件/目录。仅允许在当前工作目录下操作。",
  schema: renameArgsSchema,
  execute(args): ToolResult {
    const resolved = resolveRenamePaths(args.oldPath, args.newPath);
    if (!resolved.success) return { success: false, error: resolved.error };
    try {
      return renamePath(buildRenameArgs(args.oldPath, args.newPath, resolved));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

interface RenameArgs {
  oldPath: string;
  newPath: string;
  resolvedOld: string;
  resolvedNew: string;
}

function buildRenameArgs(
  oldPath: string,
  newPath: string,
  resolved: { oldPath: string; newPath: string },
): RenameArgs {
  return { oldPath, newPath, resolvedOld: resolved.oldPath, resolvedNew: resolved.newPath };
}

function resolveRenamePaths(
  oldPath: string,
  newPath: string,
): { success: true; oldPath: string; newPath: string } | { success: false; error: string } {
  const resolvedOld = resolveInsideWorkspace(oldPath);
  if (!resolvedOld.success) return resolvedOld;

  const resolvedNew = resolveInsideWorkspace(newPath);
  if (!resolvedNew.success) return resolvedNew;

  return { success: true, oldPath: resolvedOld.path, newPath: resolvedNew.path };
}

function renamePath(args: RenameArgs): ToolResult {
  if (!fs.existsSync(args.resolvedOld)) {
    return { success: false, error: `原路径不存在: ${args.oldPath}` };
  }

  const newDir = path.dirname(args.resolvedNew);
  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true });
  }

  fs.renameSync(args.resolvedOld, args.resolvedNew);
  return {
    success: true,
    data: `成功重命名: ${args.oldPath} → ${args.newPath}`,
  };
}

export default rename;
