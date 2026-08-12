import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { isInsideWorkspace, resolveInsideWorkspace } from "./workspacePath.js";

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_LIMIT = 1000;
const MAX_SCAN_FILES = 5000;
const MAX_FILE_SIZE_BYTES = 1024 * 1024;
const MAX_LINE_LENGTH = 500;
const RG_TIMEOUT_MS = 10000;
const RG_MAX_BUFFER = 10 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".jj",
  ".sl",
  "node_modules",
  "dist",
  ".babel-out",
]);

const search: Tool = {
  name: "search",
  description:
    "安全的 grep/glob 搜索工具。默认按内容 grep；mode='glob' 时按文件名 glob 匹配。所有路径限制在当前工作目录内。",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["grep", "glob"],
        description: "搜索模式。grep 搜索文件内容；glob 按文件名模式查找文件。默认 grep",
        default: "grep",
      },
      pattern: {
        type: "string",
        description: "grep 正则表达式，或 glob 文件名模式，如 '**/*.ts'",
      },
      path: {
        type: "string",
        description: "搜索路径，相对于当前工作目录。默认为当前目录 '.'",
        default: ".",
      },
      glob: {
        type: "string",
        description: "grep 模式下用于限定文件名的 glob，如 '*.ts' 或 '**/*.{ts,tsx}'",
      },
      fileTypes: {
        type: "string",
        description: "grep 模式兼容参数，如 '.ts,.js,.json'。会转换为 glob 过滤",
      },
      outputMode: {
        type: "string",
        enum: ["content", "files", "count"],
        description: "grep 输出模式：content 匹配行；files 文件列表；count 每文件匹配数。默认 content",
        default: "content",
      },
      caseInsensitive: {
        type: "boolean",
        description: "grep 是否忽略大小写。默认 false",
        default: false,
      },
      maxResults: {
        type: "number",
        description: `最多返回多少行或文件。默认 ${DEFAULT_MAX_RESULTS}，上限 ${MAX_RESULTS_LIMIT}`,
        default: DEFAULT_MAX_RESULTS,
      },
    },
    required: ["pattern"],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const parsed = parseSearchArgs(args);

    if (!parsed.success) return { success: false, error: parsed.error };

    try {
      return runSearch(parsed.value);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

type SearchMode = "grep" | "glob";
type GrepOutputMode = "content" | "files" | "count";

interface SearchArgs {
  mode: SearchMode;
  pattern: string;
  searchPath: string;
  resolvedPath: string;
  glob?: string;
  fileTypes?: string;
  outputMode: GrepOutputMode;
  caseInsensitive: boolean;
  maxResults: number;
}

interface FileCandidate {
  absolutePath: string;
  relativePath: string;
  matchPath: string;
}

type ParseResult = { success: true; value: SearchArgs } | { success: false; error: string };

interface ValidSearchInput {
  mode: SearchMode;
  outputMode: GrepOutputMode;
  pattern: string;
  searchPath: string;
  resolvedPath: string;
}

function parseSearchArgs(
  args: Record<string, unknown>,
): ParseResult {
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

function runSearch(args: SearchArgs): ToolResult {
  const pathCheck = validateExistingWorkspacePath(args);
  if (!pathCheck.success) return pathCheck;

  return args.mode === "glob" ? runGlob(args) : runGrep(args);
}

function validateExistingWorkspacePath(args: SearchArgs): ToolResult {
  if (!fs.existsSync(args.resolvedPath)) {
    return { success: false, error: `路径不存在: ${args.searchPath}` };
  }

  const realPath = fs.realpathSync.native(args.resolvedPath);
  if (!isInsideWorkspace(realPath)) {
    return { success: false, error: `路径穿越拒绝: ${args.searchPath}` };
  }

  return { success: true };
}

function runGrep(args: SearchArgs): ToolResult {
  const rgResult = grepWithRipgrep(args);
  if (rgResult) return rgResult;

  return grepWithNode(args);
}

function grepWithRipgrep(args: SearchArgs): ToolResult | null {
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

function buildExcludedDirectoryGlobs(): string[] {
  return [...EXCLUDED_DIRECTORIES].flatMap((directory) => [
    "--glob",
    `!${directory}`,
    "--glob",
    `!${directory}/**`,
    "--glob",
    `!**/${directory}/**`,
  ]);
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
    metadata: buildGrepMetadata(outputMode, limited),
  };
}

function parseRipgrepLines(stdout: string, outputMode: GrepOutputMode): string[] {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => relativizeRipgrepLine(line, outputMode));
}

function buildGrepMetadata(
  outputMode: GrepOutputMode,
  limited: { items: string[]; truncated: boolean },
): Record<string, unknown> {
  return {
    mode: "grep",
    outputMode,
    truncated: limited.truncated,
    resultCount: limited.items.length,
  };
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

function emptyGrepResult(outputMode: GrepOutputMode): ToolResult {
  return {
    success: true,
    data: outputMode === "files" ? "没有找到匹配文件" : "没有找到匹配项",
    metadata: { mode: "grep", outputMode, truncated: false, resultCount: 0 },
  };
}

function grepWithNode(args: SearchArgs): ToolResult {
  const regex = buildNodeRegex(args);
  const matches = listFileCandidates(args.resolvedPath)
    .filter((file) => shouldSearchFile(file, args))
    .flatMap((file) => grepFile(file, regex, args));
  const limited = limitResults(matches, args.maxResults);

  return {
    success: true,
    data: limited.items.length > 0 ? formatResultData(limited.items, limited.truncated) : emptyGrepResult(args.outputMode).data,
    metadata: {
      mode: "grep",
      outputMode: args.outputMode,
      truncated: limited.truncated,
      resultCount: limited.items.length,
    },
  };
}

function buildNodeRegex(args: SearchArgs): RegExp {
  return new RegExp(args.pattern, args.caseInsensitive ? "i" : "");
}

function shouldSearchFile(file: FileCandidate, args: SearchArgs): boolean {
  const allowedTypes = parseFileTypes(args.fileTypes);
  const globPatterns = splitGlobPatterns(args.glob);
  const fileTypeMatches =
    allowedTypes.length === 0 || allowedTypes.includes(path.extname(file.absolutePath));
  const globMatches =
    globPatterns.length === 0 ||
    globPatterns.some((globPattern) => matchesGlob(file.matchPath, globPattern));

  return fileTypeMatches && globMatches && isReadableTextFile(file.absolutePath);
}

function grepFile(file: FileCandidate, regex: RegExp, args: SearchArgs): string[] {
  const text = fs.readFileSync(file.absolutePath, "utf-8");
  const lines = text.split(/\r?\n/);
  const matchingLineIndexes = lines.flatMap((line, index) => {
    regex.lastIndex = 0;
    return regex.test(line) ? [index] : [];
  });

  if (args.outputMode === "files") {
    return matchingLineIndexes.length > 0 ? [file.relativePath] : [];
  }
  if (args.outputMode === "count") {
    return matchingLineIndexes.length > 0 ? [`${file.relativePath}:${matchingLineIndexes.length}`] : [];
  }

  return matchingLineIndexes.map((index) => {
    const line = lines[index] ?? "";
    return `${file.relativePath}:${index + 1}: ${line.trim().slice(0, MAX_LINE_LENGTH)}`;
  });
}

function runGlob(args: SearchArgs): ToolResult {
  if (!fs.statSync(args.resolvedPath).isDirectory()) {
    return { success: false, error: `glob 搜索路径必须是目录: ${args.searchPath}` };
  }
  if (path.isAbsolute(args.pattern)) {
    return { success: false, error: "glob pattern 必须相对搜索路径" };
  }

  const rgResult = globWithRipgrep(args);
  if (rgResult) return rgResult;

  return globWithNode(args);
}

function globWithRipgrep(args: SearchArgs): ToolResult | null {
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

function emptyGlobResult(): ToolResult {
  return {
    success: true,
    data: "没有找到匹配文件",
    metadata: { mode: "glob", truncated: false, resultCount: 0 },
  };
}

function globWithNode(args: SearchArgs): ToolResult {
  const matches = listFileCandidates(args.resolvedPath)
    .filter((file) => matchesGlob(file.matchPath, args.pattern))
    .map((file) => file.relativePath);
  const limited = limitResults(matches, args.maxResults);

  return {
    success: true,
    data: limited.items.length > 0 ? formatResultData(limited.items, limited.truncated) : emptyGlobResult().data,
    metadata: {
      mode: "glob",
      truncated: limited.truncated,
      resultCount: limited.items.length,
    },
  };
}

function isCommandMissing(error: Error | undefined): boolean {
  return Boolean(error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function listFileCandidates(targetPath: string): FileCandidate[] {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [{
      absolutePath: targetPath,
      relativePath: formatRelativePath(targetPath),
      matchPath: path.basename(targetPath),
    }];
  }

  const files: FileCandidate[] = [];
  collectFileCandidates(targetPath, targetPath, files);
  return files;
}

function collectFileCandidates(rootPath: string, currentPath: string, files: FileCandidate[]): void {
  if (files.length >= MAX_SCAN_FILES) return;

  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
      collectFileCandidates(rootPath, absolutePath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: formatRelativePath(absolutePath),
        matchPath: toSlashPath(path.relative(rootPath, absolutePath)),
      });
    }
  }
}

function isReadableTextFile(filePath: string): boolean {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) return false;

  const sample = Buffer.alloc(Math.min(stat.size, 1024));
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, sample, 0, sample.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  return !sample.includes(0);
}

function parseFileTypes(fileTypes: string | undefined): string[] {
  return fileTypes
    ? fileTypes.split(",").map(normalizeFileType).filter(Boolean)
    : [];
}

function normalizeFileType(fileType: string): string {
  const trimmed = fileType.trim();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function splitGlobPatterns(glob: string | undefined): string[] {
  if (!glob) return [];

  return glob
    .split(/\s+/)
    .flatMap((part) => (part.includes("{") && part.includes("}") ? [part] : part.split(",")))
    .map((part) => part.trim())
    .filter(Boolean);
}

function matchesGlob(relativePath: string, globPattern: string): boolean {
  const normalizedPath = toSlashPath(relativePath);
  const normalizedPattern = toSlashPath(globPattern);
  const target = normalizedPattern.includes("/") ? normalizedPath : path.posix.basename(normalizedPath);
  return globToRegex(normalizedPattern).test(target);
}

function globToRegex(globPattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < globPattern.length; index += 1) {
    const token = readGlobToken(globPattern, index);
    source += token.source;
    index = token.nextIndex;
  }

  return new RegExp(`${source}$`);
}

function readGlobToken(globPattern: string, index: number): { source: string; nextIndex: number } {
  const char = globPattern[index];
  if (char === "*" && globPattern[index + 1] === "*") return readDoubleStar(globPattern, index);
  if (char === "*") return { source: "[^/]*", nextIndex: index };
  if (char === "?") return { source: "[^/]", nextIndex: index };
  if (char === "{") return readGlobAlternates(globPattern, index);
  return { source: escapeRegex(char ?? ""), nextIndex: index };
}

function readDoubleStar(globPattern: string, index: number): { source: string; nextIndex: number } {
  const nextIndex = globPattern[index + 2] === "/" ? index + 2 : index + 1;
  const source = globPattern[index + 2] === "/" ? "(?:.*/)?" : ".*";
  return { source, nextIndex };
}

function readGlobAlternates(globPattern: string, index: number): { source: string; nextIndex: number } {
  const end = globPattern.indexOf("}", index + 1);
  if (end === -1) return { source: escapeRegex("{"), nextIndex: index };

  const source = globPattern
    .slice(index + 1, end)
    .split(",")
    .map(escapeRegex)
    .join("|");
  return { source: `(?:${source})`, nextIndex: end };
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function limitResults<T>(items: T[], maxResults: number): { items: T[]; truncated: boolean } {
  return {
    items: items.slice(0, maxResults),
    truncated: items.length > maxResults,
  };
}

function formatResultData(items: string[], truncated: boolean): string {
  const suffix = truncated ? "\n(结果已截断，请缩小搜索范围或提高 maxResults)" : "";
  return `${items.join("\n")}${suffix}`;
}

function formatRelativePath(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  return toSlashPath(path.relative(process.cwd(), absolutePath)) || ".";
}

function toSlashPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export default search;
