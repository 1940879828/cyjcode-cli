import fs from "node:fs";
import {
  createSnippet,
  formatWithLineNumbers,
  readTextFileMetadata,
  rememberFileSnapshot,
  splitLines,
} from "./fileState.js";
import type { Tool, ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

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
    const parsed = parseReadArgs(args);
    if (!parsed.success) return { success: false, error: parsed.error };

    const resolved = resolveInsideWorkspace(parsed.value.filePath);
    if (!resolved.success) return { success: false, error: resolved.error };

    return readFile(parsed.value, resolved.path);
  },
};

interface ReadArgs {
  filePath: string;
  offset?: number;
  limit?: number;
}

function parseReadArgs(
  args: Record<string, unknown>,
): { success: true; value: ReadArgs } | { success: false; error: string } {
  const filePath = typeof args.filePath === "string" ? args.filePath : "";
  if (!filePath) return { success: false, error: "filePath 参数不能为空" };

  return {
    success: true,
    value: {
      filePath,
      offset: typeof args.offset === "number" ? args.offset : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    },
  };
}

function readFile(args: ReadArgs, resolvedPath: string): ToolResult {
  try {
    const target = inspectReadTarget(args.filePath, resolvedPath);
    if (!target.success) return { success: false, error: target.error };

    const metadata = readTextFileMetadata(resolvedPath);
    rememberFileSnapshot(resolvedPath, metadata);
    return buildReadResult(args, resolvedPath, metadata);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function inspectReadTarget(
  filePath: string,
  resolvedPath: string,
): { success: true } | { success: false; error: string } {
  if (!fs.existsSync(resolvedPath)) {
    return { success: false, error: `文件不存在: ${filePath}` };
  }
  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    return { success: false, error: `是目录而非文件: ${filePath}` };
  }
  if (stat.size > 1024 * 1024) {
    return {
      success: false,
      error: `文件过大 (${(stat.size / 1024).toFixed(1)}KB)，超过 1MB 限制`,
    };
  }
  return { success: true };
}

function buildReadResult(
  args: ReadArgs,
  resolvedPath: string,
  metadata: ReturnType<typeof readTextFileMetadata>,
): ToolResult {
  const lines = splitLines(metadata.content);
  const parsedRange = parseReadRange(args.offset, args.limit, lines.length);
  if (!parsedRange.success) return { success: false, error: parsedRange.error };

  const { startLine, endLineExclusive } = parsedRange;
  const sliced = lines.slice(startLine, endLineExclusive);
  const displayStartLine = startLine + 1;
  const snippet = createSnippet(
    resolvedPath,
    displayStartLine,
    displayStartLine + sliced.length - 1,
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
}

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
