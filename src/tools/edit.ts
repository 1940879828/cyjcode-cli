import fs from "node:fs";
import {
  buildDiffPreview,
  createSnippet,
  formatWithLineNumbers,
  getFileSnapshot,
  getSnippet,
  hasFileChangedSinceSnapshot,
  lineRangeToOffsets,
  normalizeLineEndings,
  readTextFileMetadata,
  rememberFileSnapshot,
  splitLines,
} from "./fileState.js";
import type { Tool, ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

interface Match {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

const edit: Tool = {
  name: "edit",
  description:
    "基于 read 返回的 snippetId 对文件做安全的局部字符串替换。必须先读取文件再编辑。",
  parameters: {
    type: "object",
    properties: {
      snippetId: {
        type: "string",
        description: "read 工具返回的 snippet.id，用于限定编辑范围",
      },
      filePath: {
        type: "string",
        description: "可选的文件路径校验；如果提供，必须与 snippet 所属文件一致",
      },
      oldString: {
        type: "string",
        description: "要替换的精确文本，必须出现在 snippet 范围内",
      },
      newString: {
        type: "string",
        description: "替换后的文本，必须与 oldString 不同",
      },
      replaceAll: {
        type: "boolean",
        description: "是否替换 snippet 范围内的全部匹配项。默认为 false",
        default: false,
      },
      expectedOccurrences: {
        type: "number",
        description: "预期匹配数量；replaceAll 替换多处时必须提供",
      },
    },
    required: ["snippetId", "oldString", "newString"],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const snippetId = typeof args.snippetId === "string" ? args.snippetId.trim() : "";
    const oldString = typeof args.oldString === "string" ? args.oldString : "";
    const newString = typeof args.newString === "string" ? args.newString : "";
    const filePath = typeof args.filePath === "string" ? args.filePath.trim() : "";
    const replaceAll = args.replaceAll === true;
    const expectedOccurrences = parseExpectedOccurrences(args.expectedOccurrences);

    if (!snippetId) {
      return { success: false, error: "snippetId 参数不能为空" };
    }
    if (!oldString) {
      return { success: false, error: "oldString 参数不能为空" };
    }
    if (oldString === newString) {
      return { success: false, error: "newString 必须与 oldString 不同" };
    }
    if (!expectedOccurrences.success) {
      return { success: false, error: expectedOccurrences.error };
    }

    const snippet = getSnippet(snippetId);
    if (!snippet) {
      return { success: false, error: `未知的 snippetId: ${snippetId}。请先使用 read 读取文件。` };
    }

    if (filePath) {
      const resolved = resolveInsideWorkspace(filePath);
      if (!resolved.success) {
        return { success: false, error: resolved.error };
      }
      if (resolved.path !== snippet.filePath) {
        return { success: false, error: "filePath 与 snippetId 所属文件不一致" };
      }
    }

    const snapshot = getFileSnapshot(snippet.filePath);
    if (!snapshot) {
      return { success: false, error: "必须先使用 read 读取文件后才能编辑" };
    }
    if (hasFileChangedSinceSnapshot(snippet.filePath, snapshot)) {
      return { success: false, error: "文件在读取后已被修改。请重新 read 后再 edit。" };
    }

    try {
      const metadata = readTextFileMetadata(snippet.filePath);
      const scope = lineRangeToOffsets(metadata.content, snippet.startLine, snippet.endLine);
      const scopedText = metadata.content.slice(scope.start, scope.end);
      const replacementOldString = normalizeLineEndings(oldString, metadata.lineEndings);
      const replacementNewString = normalizeLineEndings(newString, metadata.lineEndings);
      const matches = findMatches(scopedText, replacementOldString, metadata.content, scope.start);

      if (matches.length === 0) {
        return {
          success: false,
          error: "oldString 未在 snippet 范围内找到",
          metadata: { scope: buildScopeMetadata(snippet) },
        };
      }

      if (!replaceAll && matches.length > 1) {
        return {
          success: false,
          error: "oldString 在 snippet 范围内不唯一；请使用候选 snippetId 提供更具体的 oldString，或使用 replaceAll",
          metadata: {
            matchCount: matches.length,
            candidates: buildCandidateMetadata(snippet.filePath, metadata, matches),
            scope: buildScopeMetadata(snippet),
          },
        };
      }

      const expected = expectedOccurrences.value;
      if (expected !== undefined && expected !== matches.length) {
        return {
          success: false,
          error: `expectedOccurrences 为 ${expected}，但实际找到 ${matches.length} 处匹配`,
          metadata: {
            matchCount: matches.length,
            scope: buildScopeMetadata(snippet),
          },
        };
      }
      if (replaceAll && matches.length > 1 && expected === undefined) {
        return {
          success: false,
          error: `replaceAll 将影响 ${matches.length} 处匹配；请提供 expectedOccurrences 确认数量`,
          metadata: {
            matchCount: matches.length,
            scope: buildScopeMetadata(snippet),
          },
        };
      }

      const editedScope = applyMatches(scopedText, matches, scope.start, replacementNewString, replaceAll);
      const updated = normalizeLineEndings(
        `${metadata.content.slice(0, scope.start)}${editedScope}${metadata.content.slice(scope.end)}`,
        metadata.lineEndings,
      );
      fs.writeFileSync(snippet.filePath, updated, "utf-8");

      const freshMetadata = readTextFileMetadata(snippet.filePath);
      rememberFileSnapshot(snippet.filePath, freshMetadata);
      const freshScope = lineRangeToOffsets(freshMetadata.content, snippet.startLine, snippet.endLine);
      const freshSnippet = createSnippet(
        snippet.filePath,
        snippet.startLine,
        snippet.endLine,
        freshMetadata.content.slice(freshScope.start, freshScope.end),
        freshMetadata,
      );

      return {
        success: true,
        data: `成功替换 ${replaceAll ? matches.length : 1} 处匹配`,
        metadata: {
          filePath: snippet.filePath,
          replacedCount: replaceAll ? matches.length : 1,
          diffPreview: buildDiffPreview(metadata.content, updated),
          snippet: {
            id: freshSnippet.id,
            filePath: freshSnippet.filePath,
            startLine: freshSnippet.startLine,
            endLine: freshSnippet.endLine,
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

function parseExpectedOccurrences(
  value: unknown,
): { success: true; value?: number } | { success: false; error: string } {
  if (value === undefined || value === null) {
    return { success: true };
  }
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    return { success: false, error: "expectedOccurrences 必须是大于等于 1 的整数" };
  }
  return { success: true, value: numericValue };
}

function findMatches(scopedText: string, oldString: string, fullContent: string, scopeStart: number): Match[] {
  if (!oldString) {
    return [];
  }

  const matches: Match[] = [];
  let searchFrom = 0;

  while (searchFrom <= scopedText.length) {
    const found = scopedText.indexOf(oldString, searchFrom);
    if (found === -1) {
      break;
    }
    const absoluteStart = scopeStart + found;
    const absoluteEnd = absoluteStart + oldString.length;
    matches.push({
      start: absoluteStart,
      end: absoluteEnd,
      startLine: offsetToLine(fullContent, absoluteStart),
      endLine: offsetToLine(fullContent, Math.max(absoluteStart, absoluteEnd - 1)),
    });
    searchFrom = found + oldString.length;
  }

  return matches;
}

function offsetToLine(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index++) {
    if (content[index] === "\n") {
      line++;
    }
  }
  return line;
}

function applyMatches(
  scopedText: string,
  matches: readonly Match[],
  scopeStart: number,
  newString: string,
  replaceAll: boolean,
): string {
  const selectedMatches = replaceAll ? matches : matches.slice(0, 1);
  let result = "";
  let cursor = scopeStart;
  for (const match of selectedMatches) {
    result += scopedText.slice(cursor - scopeStart, match.start - scopeStart);
    result += newString;
    cursor = match.end;
  }
  result += scopedText.slice(cursor - scopeStart);
  return result;
}

function buildCandidateMetadata(
  filePath: string,
  metadata: ReturnType<typeof readTextFileMetadata>,
  matches: readonly Match[],
): Array<Record<string, unknown>> {
  const lines = splitLines(metadata.content);
  return matches.slice(0, 5).map((match) => {
    const startLine = Math.max(1, match.startLine - 2);
    const endLine = Math.min(lines.length, match.endLine + 2);
    const selectedLines = lines.slice(startLine - 1, endLine);
    const snippet = createSnippet(filePath, startLine, endLine, selectedLines.join("\n"), metadata);
    return {
      snippetId: snippet.id,
      startLine,
      endLine,
      preview: formatWithLineNumbers(selectedLines, startLine),
    };
  });
}

function buildScopeMetadata(snippet: { id: string; filePath: string; startLine: number; endLine: number }): Record<string, unknown> {
  return {
    snippetId: snippet.id,
    filePath: snippet.filePath,
    startLine: snippet.startLine,
    endLine: snippet.endLine,
  };
}

export default edit;
