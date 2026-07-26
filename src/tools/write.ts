import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";

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
    const filePath = args.filePath as string;
    const content = args.content as string;

    if (!filePath) {
      return {
        success: false,
        error: "filePath 参数不能为空",
      };
    }
    if (content === undefined || content === null) {
      return {
        success: false,
        error: "content 参数不能为空",
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
      // 确保父目录存在
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, "utf-8");
      const size = Buffer.byteLength(content, "utf-8");
      return {
        success: true,
        data: `成功写入 ${filePath} (${size} 字节)`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default write;
