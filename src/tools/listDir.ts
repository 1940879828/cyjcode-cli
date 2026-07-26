import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";

const listDir: Tool = {
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
    const targetPath = (args.path as string) || ".";
    const recursive = (args.recursive as boolean) || false;

    // 安全检查：防止路径穿越
    const resolved = path.resolve(targetPath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `路径穿越拒绝: ${targetPath}`,
      };
    }

    try {
      if (!fs.existsSync(resolved)) {
        return {
          success: false,
          error: `路径不存在: ${targetPath}`,
        };
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          success: false,
          error: `不是目录: ${targetPath}`,
        };
      }

      const listDirRecursive = (dir: string, prefix: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const result: string[] = [];
        for (const entry of entries) {
          const fullPath = path.join(prefix, entry.name);
          if (entry.isDirectory()) {
            result.push(`${fullPath}/`);
            if (recursive) {
              result.push(
                ...listDirRecursive(
                  path.join(dir, entry.name),
                  fullPath
                )
              );
            }
          } else {
            result.push(fullPath);
          }
        }
        return result;
      };

      const files = listDirRecursive(resolved, targetPath === "." ? "" : targetPath);
      return {
        success: true,
        data: files.length > 0 ? files.join("\n") : "(空目录)",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default listDir;
