import { resolveInsideWorkspace } from "../workspacePath.js";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT } from "./searchTypes.js";
import type { GrepOutputMode, SearchArgs, SearchMode } from "./searchTypes.js";

type ParseResult = { success: true; value: SearchArgs } | { success: false; error: string };

interface ValidSearchInput {
  mode: SearchMode;
  outputMode: GrepOutputMode;
  pattern: string;
  searchPath: string;
  resolvedPath: string;
}

export function parseSearchArgs(args: Record<string, unknown>): ParseResult {
  const mode = parseMode(args.mode);
  const outputMode = parseOutputMode(args.outputMode);
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  const searchPath = typeof args.path === "string" && args.path ? args.path : ".";
  const resolved = resolveInsideWorkspace(searchPath);

  if (!mode) return { success: false, error: "mode 参数必须是 grep 或 glob" };
  if (!outputMode) return { success: false, error: "outputMode 参数必须是 content、files 或 count" };
  if (!pattern) return { success: false, error: "pattern 参数不能为空" };
  if (!resolved.success) return resolved;

  return {
    success: true,
    value: buildSearchArgs(args, { mode, outputMode, pattern, searchPath, resolvedPath: resolved.path }),
  };
}

function buildSearchArgs(
  args: Record<string, unknown>,
  input: ValidSearchInput,
): SearchArgs {
  return {
    mode: input.mode,
    pattern: input.pattern,
    searchPath: input.searchPath,
    resolvedPath: input.resolvedPath,
    glob: stringArg(args.glob),
    fileTypes: stringArg(args.fileTypes),
    outputMode: input.outputMode,
    caseInsensitive: args.caseInsensitive === true,
    maxResults: parseMaxResults(args.maxResults),
  };
}

function parseMode(value: unknown): SearchMode | undefined {
  if (value === undefined || value === null || value === "") return "grep";
  return value === "grep" || value === "glob" ? value : undefined;
}

function parseOutputMode(value: unknown): GrepOutputMode | undefined {
  if (value === undefined || value === null || value === "") return "content";
  return value === "content" || value === "files" || value === "count" ? value : undefined;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(Math.trunc(value), MAX_RESULTS_LIMIT));
}
