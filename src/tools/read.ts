import fs from "node:fs";
import {
  createSnippet,
  formatWithLineNumbers,
  readTextFileMetadata,
  rememberFileSnapshot,
  resolveInsideWorkspace,
  splitLines,
} from "./fileState.js";
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

    const resolved = resolveInsideWorkspace(filePath);
    if (!resolved.success) {
      return {
        success: false,
        error: resolved.error,
      };
    }

    try {
      if (!fs.existsSync(resolved.path)) {
        return {
          success: false,
          error: `文件不存在: ${filePath}`,
        };
      }

      const stat = fs.statSync(resolved.path);
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

      const metadata = readTextFileMetadata(resolved.path);
      rememberFileSnapshot(resolved.path, metadata);
      const lines = splitLines(metadata.content);

      const parsedRange = parseReadRange(offset, limit, lines.length);
      if (!parsedRange.success) {
        return {
          success: false,
          error: parsedRange.error,
        };
      }

      const { startLine, endLineExclusive } = parsedRange;
      const sliced = lines.slice(startLine, endLineExclusive);
      const displayStartLine = startLine + 1;
      const displayEndLine = displayStartLine + sliced.length - 1;
      const snippet = createSnippet(
        resolved.path,
        displayStartLine,
        displayEndLine,
        sliced.join("\n"),
        metadata,
      );
      const numbered = metadata.content === "" ? "" : formatWithLineNumbers(sliced, displayStartLine);

      return {
        success: true,
        data: numbered || "(空文件)",
        metadata: {
          snippet: {
            id: snippet.id,
            filePath: snippet.filePath,
            startLine: snippet.startLine,
            endLine: snippet.endLine,
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

function parseReadRange(
  offset: number | undefined,
  limit: number | undefined,
  totalLines: number,
): { success: true; startLine: number; endLineExclusive: number } | { success: false; error: string } {
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
    return {
      success: false,
      error: "offset 必须是大于等于 1 的整数",
    };
  }

  const startLine = offset === undefined ? 0 : offset - 1;
  if (startLine >= totalLines) {
    return {
      success: false,
      error: `offset ${offset} 超出文件行数范围 (共 ${totalLines} 行)`,
    };
  }

  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return {
      success: false,
      error: "limit 必须是大于 0 的整数",
    };
  }

  return {
    success: true,
    startLine,
    endLineExclusive: limit === undefined ? totalLines : Math.min(startLine + limit, totalLines),
  };
}

export default read;
