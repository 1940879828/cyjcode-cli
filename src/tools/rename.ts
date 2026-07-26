import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";

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
    const oldPath = args.oldPath as string;
    const newPath = args.newPath as string;

    if (!oldPath) {
      return {
        success: false,
        error: "oldPath 参数不能为空",
      };
    }
    if (!newPath) {
      return {
        success: false,
        error: "newPath 参数不能为空",
      };
    }

    // 安全检查
    const resolvedOld = path.resolve(oldPath);
    const resolvedNew = path.resolve(newPath);
    const cwd = process.cwd();
    if (!resolvedOld.startsWith(cwd)) {
      return {
        success: false,
        error: `路径穿越拒绝: ${oldPath}`,
      };
    }
    if (!resolvedNew.startsWith(cwd)) {
      return {
        success: false,
        error: `路径穿越拒绝: ${newPath}`,
      };
    }

    try {
      if (!fs.existsSync(resolvedOld)) {
        return {
          success: false,
          error: `原路径不存在: ${oldPath}`,
        };
      }

      // 确保目标父目录存在
      const newDir = path.dirname(resolvedNew);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      fs.renameSync(resolvedOld, resolvedNew);
      return {
        success: true,
        data: `成功重命名: ${oldPath} → ${newPath}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default rename;
