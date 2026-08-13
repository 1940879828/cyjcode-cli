import { spawnSync } from "node:child_process";
import path from "node:path";
import type { ToolResult } from "../types.js";
import { parseFileTypes, splitGlobPatterns } from "./globPattern.js";
import {
  buildExcludedDirectoryGlobs,
  emptyGlobResult,
  emptyGrepResult,
  formatRelativePath,
  formatResultData,
  isCommandMissing,
  limitResults,
} from "./searchResult.js";
import {
  MAX_LINE_LENGTH,
  RG_MAX_BUFFER,
  RG_TIMEOUT_MS,
  type GrepOutputMode,
  type SearchArgs,
} from "./searchTypes.js";

export function grepWithRipgrep(args: SearchArgs): ToolResult | null {
  const result = spawnSync("rg", buildGrepRipgrepArgs(args), {
    encoding: "utf-8",
    maxBuffer: RG_MAX_BUFFER,
    timeout: RG_TIMEOUT_MS,
    windowsHide: true,
  });

  if (isCommandMissing(result.error)) return null;
  if (result.error) return { success: false, error: `搜索超时或执行失败: ${result.error.message}` };
  if (result.status === 1) return emptyGrepResult(args.outputMode);
  if (result.status === null || result.status > 1) {
    return { success: false, error: result.stderr.trim() || `rg 退出码异常: ${result.status}` };
  }

  return formatRipgrepOutput(result.stdout, args.outputMode, args.maxResults);
}

export function globWithRipgrep(args: SearchArgs): ToolResult | null {
  const result = spawnSync("rg", buildGlobRipgrepArgs(args), {
    encoding: "utf-8",
    maxBuffer: RG_MAX_BUFFER,
    timeout: RG_TIMEOUT_MS,
    windowsHide: true,
  });

  if (isCommandMissing(result.error)) return null;
  if (result.error) return { success: false, error: `glob 搜索超时或执行失败: ${result.error.message}` };
  if (result.status === 1) return emptyGlobResult();
  if (result.status === null || result.status > 1) {
    return { success: false, error: result.stderr.trim() || `rg 退出码异常: ${result.status}` };
  }

  return formatGlobResults(result.stdout, args);
}

function buildGrepRipgrepArgs(args: SearchArgs): string[] {
  const rgArgs = buildBaseGrepRipgrepArgs();

  if (args.caseInsensitive) rgArgs.push("--ignore-case");
  if (args.outputMode === "files") rgArgs.push("--files-with-matches");
  if (args.outputMode === "count") rgArgs.push("--count");
  appendSearchPattern(rgArgs, args.pattern);
  rgArgs.push(...buildGrepGlobArgs(args));
  rgArgs.push(args.resolvedPath);
  return rgArgs;
}

function buildBaseGrepRipgrepArgs(): string[] {
  return [
    "--line-number",
    "--no-heading",
    "--max-columns",
    String(MAX_LINE_LENGTH),
    "--hidden",
    ...buildExcludedDirectoryGlobs(),
  ];
}

function appendSearchPattern(rgArgs: string[], pattern: string): void {
  if (pattern.startsWith("-")) {
    rgArgs.push("-e", pattern);
    return;
  }
  rgArgs.push(pattern);
}

function buildGrepGlobArgs(args: SearchArgs): string[] {
  const globPatterns = [
    ...splitGlobPatterns(args.glob),
    ...parseFileTypes(args.fileTypes).map((type) => `*${type}`),
  ];
  return globPatterns.flatMap((globPattern) => ["--glob", globPattern]);
}

function formatRipgrepOutput(
  stdout: string,
  outputMode: GrepOutputMode,
  maxResults: number,
): ToolResult {
  const lines = parseRipgrepLines(stdout, outputMode);
  if (lines.length === 0) return emptyGrepResult(outputMode);

  const limited = limitResults(lines, maxResults);
  return {
    success: true,
    data: formatResultData(limited.items, limited.truncated),
    metadata: {
      mode: "grep",
      outputMode,
      truncated: limited.truncated,
      resultCount: limited.items.length,
    },
  };
}

function parseRipgrepLines(stdout: string, outputMode: GrepOutputMode): string[] {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => relativizeRipgrepLine(line, outputMode));
}

function relativizeRipgrepLine(line: string, outputMode: GrepOutputMode): string {
  if (outputMode === "files") return formatRelativePath(line);

  const separatorIndex = outputMode === "count"
    ? line.lastIndexOf(":")
    : findContentLineSeparator(line);
  if (separatorIndex <= 0) return line;

  const filePath = line.slice(0, separatorIndex);
  const suffix = line.slice(separatorIndex);
  return `${formatRelativePath(filePath)}${suffix}`;
}

function findContentLineSeparator(line: string): number {
  const match = line.match(/^(.*?):\d+:/);
  return match?.[1]?.length ?? -1;
}

function buildGlobRipgrepArgs(args: SearchArgs): string[] {
  return [
    "--files",
    "--hidden",
    ...buildExcludedDirectoryGlobs(),
    "--glob",
    args.pattern,
    args.resolvedPath,
  ];
}

function formatGlobResults(stdout: string, args: SearchArgs): ToolResult {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return emptyGlobResult();

  const relativePaths = lines.map((filePath) =>
    formatRelativePath(path.isAbsolute(filePath) ? filePath : path.resolve(filePath)),
  );
  const limited = limitResults(relativePaths, args.maxResults);
  return {
    success: true,
    data: formatResultData(limited.items, limited.truncated),
    metadata: {
      mode: "glob",
      truncated: limited.truncated,
      resultCount: limited.items.length,
    },
  };
}
