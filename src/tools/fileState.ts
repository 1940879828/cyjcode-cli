import fs from "node:fs";
export { resolveInsideWorkspace } from "./workspacePath.js";

type LineEndings = "LF" | "CRLF";

export interface FileSnapshot {
  filePath: string;
  content: string;
  timestamp: number;
  lineEndings: LineEndings;
}

export interface FileSnippet {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  timestamp: number;
  lineEndings: LineEndings;
}

export interface TextFileMetadata {
  content: string;
  timestamp: number;
  lineEndings: LineEndings;
}

export interface CreateSnippetInput {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  metadata: TextFileMetadata;
}

let nextSnippetIndex = 1;
const snippets = new Map<string, FileSnippet>();
const fileSnapshots = new Map<string, FileSnapshot>();

export function readTextFileMetadata(filePath: string): TextFileMetadata {
  const content = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);
  return {
    content,
    timestamp: stat.mtimeMs,
    lineEndings: content.includes("\r\n") ? "CRLF" : "LF",
  };
}

export function rememberFileSnapshot(filePath: string, metadata: TextFileMetadata): void {
  fileSnapshots.set(filePath, {
    filePath,
    content: metadata.content,
    timestamp: metadata.timestamp,
    lineEndings: metadata.lineEndings,
  });
}

export function createSnippet(input: CreateSnippetInput): FileSnippet {
  const snippet: FileSnippet = {
    id: `snippet_${nextSnippetIndex++}`,
    filePath: input.filePath,
    startLine: input.startLine,
    endLine: input.endLine,
    content: input.content,
    timestamp: input.metadata.timestamp,
    lineEndings: input.metadata.lineEndings,
  };
  snippets.set(snippet.id, snippet);
  return snippet;
}

export function getSnippet(snippetId: string): FileSnippet | undefined {
  return snippets.get(snippetId);
}

export function getFileSnapshot(filePath: string): FileSnapshot | undefined {
  return fileSnapshots.get(filePath);
}

export function hasFileChangedSinceSnapshot(filePath: string, snapshot: FileSnapshot): boolean {
  if (!fs.existsSync(filePath)) {
    return true;
  }

  const metadata = readTextFileMetadata(filePath);
  return metadata.timestamp !== snapshot.timestamp || metadata.content !== snapshot.content;
}

export function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function lineRangeToOffsets(content: string, startLine: number, endLine: number): { start: number; end: number } {
  const lines = splitLines(content);
  let start = 0;
  for (let index = 0; index < startLine - 1; index++) {
    start += lines[index]!.length;
    start += getLineEndingLength(content, start);
  }

  let end = start;
  for (let index = startLine - 1; index < endLine && index < lines.length; index++) {
    end += lines[index]!.length;
    if (index < lines.length - 1) {
      end += getLineEndingLength(content, end);
    }
  }

  return { start, end };
}

function getLineEndingLength(content: string, offset: number): 0 | 1 | 2 {
  if (offset >= content.length) {
    return 0;
  }
  if (content[offset] === "\r" && content[offset + 1] === "\n") {
    return 2;
  }
  return content[offset] === "\n" || content[offset] === "\r" ? 1 : 0;
}

export function formatWithLineNumbers(lines: readonly string[], startLine: number): string {
  return lines.map((line, index) => `${startLine + index}: ${line}`).join("\n");
}

export function normalizeLineEndings(content: string, lineEndings: LineEndings): string {
  const lfContent = content.replace(/\r\n/g, "\n");
  return lineEndings === "CRLF" ? lfContent.replace(/\n/g, "\r\n") : lfContent;
}

export function buildDiffPreview(before: string, after: string, contextLines = 2): string {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const firstChanged = findFirstChangedLine(beforeLines, afterLines);
  if (firstChanged === -1) {
    return "(无文本差异)";
  }

  const lastChanged = findLastChangedLine(beforeLines, afterLines);
  const start = Math.max(0, firstChanged - contextLines);
  const beforeEnd = Math.min(beforeLines.length, lastChanged.before + contextLines + 1);
  const afterEnd = Math.min(afterLines.length, lastChanged.after + contextLines + 1);

  return formatDiffPreview({ beforeLines, afterLines, start, beforeEnd, afterEnd });
}

function formatDiffPreview(input: {
  beforeLines: string[];
  afterLines: string[];
  start: number;
  beforeEnd: number;
  afterEnd: number;
}): string {
  return [
    "--- before",
    "+++ after",
    `@@ -${input.start + 1},${input.beforeEnd - input.start} +${input.start + 1},${input.afterEnd - input.start} @@`,
    ...input.beforeLines.slice(input.start, input.beforeEnd).map((line) => `-${line}`),
    ...input.afterLines.slice(input.start, input.afterEnd).map((line) => `+${line}`),
  ].join("\n");
}

function findFirstChangedLine(beforeLines: readonly string[], afterLines: readonly string[]): number {
  const maxLength = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLength; index++) {
    if (beforeLines[index] !== afterLines[index]) {
      return index;
    }
  }
  return -1;
}

function findLastChangedLine(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): { before: number; after: number } {
  let beforeIndex = beforeLines.length - 1;
  let afterIndex = afterLines.length - 1;
  while (beforeIndex >= 0 && afterIndex >= 0 && beforeLines[beforeIndex] === afterLines[afterIndex]) {
    beforeIndex--;
    afterIndex--;
  }
  return {
    before: Math.max(0, beforeIndex),
    after: Math.max(0, afterIndex),
  };
}
