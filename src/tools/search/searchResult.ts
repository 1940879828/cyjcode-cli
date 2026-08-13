import path from "node:path";
import type { ToolResult } from "../types.js";
import { EXCLUDED_DIRECTORIES } from "./searchTypes.js";
import type { GrepOutputMode } from "./searchTypes.js";

export function buildExcludedDirectoryGlobs(): string[] {
  return [...EXCLUDED_DIRECTORIES].flatMap((directory) => [
    "--glob",
    `!${directory}`,
    "--glob",
    `!${directory}/**`,
    "--glob",
    `!**/${directory}/**`,
  ]);
}

export function emptyGrepResult(outputMode: GrepOutputMode): ToolResult {
  return {
    success: true,
    data: outputMode === "files" ? "没有找到匹配文件" : "没有找到匹配项",
    metadata: { mode: "grep", outputMode, truncated: false, resultCount: 0 },
  };
}

export function emptyGlobResult(): ToolResult {
  return {
    success: true,
    data: "没有找到匹配文件",
    metadata: { mode: "glob", truncated: false, resultCount: 0 },
  };
}

export function limitResults<T>(items: T[], maxResults: number): { items: T[]; truncated: boolean } {
  return {
    items: items.slice(0, maxResults),
    truncated: items.length > maxResults,
  };
}

export function formatResultData(items: string[], truncated: boolean): string {
  const suffix = truncated ? "\n(结果已截断，请缩小搜索范围或提高 maxResults)" : "";
  return `${items.join("\n")}${suffix}`;
}

export function formatRelativePath(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  return toSlashPath(path.relative(process.cwd(), absolutePath)) || ".";
}

export function toSlashPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function isCommandMissing(error: Error | undefined): boolean {
  return Boolean(error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}
