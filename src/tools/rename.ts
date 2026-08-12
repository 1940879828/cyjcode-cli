import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const rename: Tool = {
  name: "rename",
  description:
    "重命名或移动文件/目录。仅允许在当前工作目录下操作。",
  parameters: {
    type: "object",
    properties: {
      oldPath: {
        type: "string",
        description: "原文件路径，相对于当前工作目录",
      },
      newPath: {
        type: "string",
        description: "新文件路径，相对于当前工作目录",
      },
    },
    required: ["oldPath", "newPath"],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const parsed = parseRenameArgs(args);
    if (!parsed.success) return { success: false, error: parsed.error };

    try {
      return renamePath(parsed.value);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

interface RenameArgs {
  oldPath: string;
  newPath: string;
  resolvedOld: string;
  resolvedNew: string;
}

function parseRenameArgs(
  args: Record<string, unknown>,
): { success: true; value: RenameArgs } | { success: false; error: string } {
  const oldPath = typeof args.oldPath === "string" ? args.oldPath : "";
  const newPath = typeof args.newPath === "string" ? args.newPath : "";

  if (!oldPath) return { success: false, error: "oldPath 参数不能为空" };
  if (!newPath) return { success: false, error: "newPath 参数不能为空" };

  const resolved = resolveRenamePaths(oldPath, newPath);
  if (!resolved.success) return resolved;

  return { success: true, value: buildRenameArgs(oldPath, newPath, resolved) };
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
