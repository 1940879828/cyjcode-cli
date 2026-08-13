import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const listDir = {
  name: "listDir",
  description:
    "列出指定目录下的文件和子目录。返回文件名列表。",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "要列出的目录路径，相对于当前工作目录。默认为当前目录 '.'",
        default: ".",
      },
      recursive: {
        type: "boolean",
        description:
          "是否递归列出所有子目录。默认为 false",
        default: false,
      },
    },
    required: [],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const parsed = parseListDirArgs(args);
    if (!parsed.success) return { success: false, error: parsed.error };

    try {
      return listDirectory(parsed.value);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
} satisfies Tool;

interface ListDirArgs {
  targetPath: string;
  recursive: boolean;
  resolvedPath: string;
}

interface DirectoryEntryContext {
  dir: string;
  prefix: string;
  recursive: boolean;
  entry: fs.Dirent;
}

function parseListDirArgs(
  args: Record<string, unknown>,
): { success: true; value: ListDirArgs } | { success: false; error: string } {
  const targetPath = typeof args.path === "string" && args.path ? args.path : ".";
  const recursive = args.recursive === true;
  const resolved = resolveInsideWorkspace(targetPath);

  if (!resolved.success) return resolved;

  return {
    success: true,
    value: { targetPath, recursive, resolvedPath: resolved.path },
  };
}

function listDirectory(args: ListDirArgs): ToolResult {
  if (!fs.existsSync(args.resolvedPath)) {
    return { success: false, error: `路径不存在: ${args.targetPath}` };
  }

  if (!fs.statSync(args.resolvedPath).isDirectory()) {
    return { success: false, error: `不是目录: ${args.targetPath}` };
  }

  const files = collectDirectoryEntries(args);
  return {
    success: true,
    data: files.length > 0 ? files.join("\n") : "(空目录)",
  };
}

function collectDirectoryEntries(args: ListDirArgs): string[] {
  return listDirRecursive(
    args.resolvedPath,
    args.targetPath === "." ? "" : args.targetPath,
    args.recursive,
  );
}

function listDirRecursive(
  dir: string,
  prefix: string,
  recursive: boolean,
): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    formatDirectoryEntry({ dir, prefix, recursive, entry }),
  );
}

function formatDirectoryEntry(context: DirectoryEntryContext): string[] {
  const fullPath = path.join(context.prefix, context.entry.name);
  if (!context.entry.isDirectory()) return [fullPath];

  const childEntries = context.recursive
    ? listDirRecursive(path.join(context.dir, context.entry.name), fullPath, context.recursive)
    : [];
  return [`${fullPath}/`, ...childEntries];
}

export default listDir;
