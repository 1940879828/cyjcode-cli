import fs from "node:fs";
import { z } from "zod";
import {
  createSnippet,
  formatWithLineNumbers,
  readTextFileMetadata,
  rememberFileSnapshot,
  splitLines,
} from "./fileState.js";
import { defineTool } from "./defineTool.js";
import type { ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const optionalNumber = () => z.preprocess(
  (value) => (typeof value === "number" ? value : undefined),
  z.number().optional(),
);

const readArgsSchema = z.object({
  filePath: z.string().min(1, "filePath 参数不能为空")
    .describe("要读取的文件路径，相对于当前工作目录"),
  offset: optionalNumber().describe("从第几行开始读取（从 1 开始）。不指定则从开头读取"),
  limit: optionalNumber().describe("最多读取多少行。不指定则读取全部"),
});

const read = defineTool({
  name: "read",
  description:
    "读取指定文件的内容。支持指定偏移量和行数限制来读取文件的部分内容。",
  schema: readArgsSchema,
  execute(args): ToolResult {
    const resolved = resolveInsideWorkspace(args.filePath);
    if (!resolved.success) return { success: false, error: resolved.error };

    return readFile(args, resolved.path);
  },
});

type ReadArgs = z.infer<typeof readArgsSchema>;

interface ReadRange {
  startLine: number;
  endLineExclusive: number;
}

interface ReadSnippetInput {
  resolvedPath: string;
  metadata: ReturnType<typeof readTextFileMetadata>;
  range: ReadRange;
  lines: string[];
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

  const sliced = lines.slice(parsedRange.startLine, parsedRange.endLineExclusive);
  const snippet = createReadSnippet({ resolvedPath, metadata, range: parsedRange, lines: sliced });
  return {
    success: true,
    data: formatReadData(metadata.content, sliced, snippet.startLine),
    metadata: { snippet: buildSnippetMetadata(snippet) },
  };
}

function createReadSnippet(input: ReadSnippetInput) {
  const displayStartLine = input.range.startLine + 1;
  return createSnippet({
    filePath: input.resolvedPath,
    startLine: displayStartLine,
    endLine: displayStartLine + input.lines.length - 1,
    content: input.lines.join("\n"),
    metadata: input.metadata,
  });
}

function formatReadData(content: string, lines: string[], startLine: number): string {
  if (content === "") return "(空文件)";
  return formatWithLineNumbers(lines, startLine);
}

function buildSnippetMetadata(snippet: {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  contentFingerprint: string;
}): Record<string, unknown> {
  return {
    id: snippet.id,
    filePath: snippet.filePath,
    startLine: snippet.startLine,
    endLine: snippet.endLine,
    contentFingerprint: snippet.contentFingerprint,
  };
}

function parseReadRange(
  offset: number | undefined,
  limit: number | undefined,
  totalLines: number,
): { success: true } & ReadRange | { success: false; error: string } {
  const offsetError = validateOffset(offset, totalLines);
  if (offsetError) return { success: false, error: offsetError };

  const limitError = validateLimit(limit);
  if (limitError) return { success: false, error: limitError };

  const startLine = offset === undefined ? 0 : offset - 1;
  return {
    success: true,
    startLine,
    endLineExclusive: limit === undefined ? totalLines : Math.min(startLine + limit, totalLines),
  };
}

function validateOffset(offset: number | undefined, totalLines: number): string | undefined {
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
    return "offset 必须是大于等于 1 的整数";
  }

  const startLine = offset === undefined ? 0 : offset - 1;
  return startLine >= totalLines ? `offset ${offset} 超出文件行数范围 (共 ${totalLines} 行)` : undefined;
}

function validateLimit(limit: number | undefined): string | undefined {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    return "limit 必须是大于 0 的整数";
  }
  return undefined;
}

export default read;
