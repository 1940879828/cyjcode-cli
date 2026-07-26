import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";

const read: Tool = {
  name: "read",
  description:
    "读取指定文件的内容。支持指定偏移量和行数限制来读取文件的部分内容。",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "要读取的文件路径，相对于当前工作目录",
      },
      offset: {
        type: "number",
        description: "从第几行开始读取（从 1 开始）。不指定则从开头读取",
      },
      limit: {
        type: "number",
        description: "最多读取多少行。不指定则读取全部",
      },
    },
    required: ["filePath"],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const filePath = args.filePath as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;

    if (!filePath) {
      return {
        success: false,
        error: "filePath 参数不能为空",
      };
    }

    // 安全检查
    const resolved = path.resolve(filePath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `路径穿越拒绝: ${filePath}`,
      };
    }

    try {
      if (!fs.existsSync(resolved)) {
        return {
          success: false,
          error: `文件不存在: ${filePath}`,
        };
      }

      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        return {
          success: false,
          error: `是目录而非文件: ${filePath}`,
        };
      }

      // 文件大小限制：最多 1MB
      if (stat.size > 1024 * 1024) {
        return {
          success: false,
          error: `文件过大 (${(stat.size / 1024).toFixed(1)}KB)，超过 1MB 限制`,
        };
      }

      const content = fs.readFileSync(resolved, "utf-8");
      const lines = content.split("\n");

      const startLine = (offset ?? 1) - 1;
      const endLine = limit
        ? Math.min(startLine + limit, lines.length)
        : lines.length;

      if (startLine < 0 || startLine >= lines.length) {
        return {
          success: false,
          error: `offset ${offset} 超出文件行数范围 (共 ${lines.length} 行)`,
        };
      }

      const sliced = lines.slice(startLine, endLine);
      // 添加行号
      const numbered = sliced
        .map((line, i) => `${startLine + i + 1}: ${line}`)
        .join("\n");

      return {
        success: true,
        data: numbered || "(空文件)",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default read;
