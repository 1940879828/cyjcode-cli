import path from "node:path";
import type { ToolResult } from "../tools/types.js";

export interface ToolDisplayContext {
  name: string;
  arguments: Record<string, unknown>;
  result: ToolResult;
}

export function formatToolDisplay(context: ToolDisplayContext): string {
  const target = getToolTarget(context);
  const range = getLineRange(context.result.metadata);
  const formatter = TOOL_DISPLAY_FORMATTERS[context.name];

  return formatter ? formatter(target, range) : `调用工具"${context.name}"`;
}

const TOOL_DISPLAY_FORMATTERS: Record<string, (target: string, range: string) => string> = {
  read: (target, range) => `👀读取文件"${target}"${range}`,
  edit: (target, range) => `✍️编辑文件"${target}"${range}`,
  search: (target) => `🔍搜索文件"${target}"`,
  write: (target) => `✍️写入文件"${target}"`,
  rename: (target) => `✍️重命名文件"${target}"`,
  listDir: (target) => `📁查看目录"${target}"`,
  shell: (target) => `⚙️运行命令"${target}"`,
};

export function formatToolErrorDisplay(context: ToolDisplayContext): string {
  return `${formatToolDisplay(context)} 失败: ${context.result.error ?? "未知错误"}`;
}

function getToolTarget(context: ToolDisplayContext): string {
  const metadataPath = getMetadataPath(context.result.metadata);
  if (metadataPath) return formatPath(metadataPath);

  const specialTarget = getSpecialToolTarget(context);
  if (specialTarget) return specialTarget;

  const target =
    stringArg(context.arguments.filePath) ||
    stringArg(context.arguments.path) ||
    stringArg(context.arguments.pattern) ||
    context.name;
  return formatPath(target);
}

function getSpecialToolTarget(context: ToolDisplayContext): string | undefined {
  if (context.name === "search") return formatPath(stringArg(context.arguments.path) || ".");
  if (context.name === "rename") return formatRenameTarget(context.arguments);
  if (context.name === "shell") return formatShellTarget(context.arguments);
  return undefined;
}

function formatRenameTarget(args: Record<string, unknown>): string {
  return `${stringArg(args.oldPath) || "?"} → ${stringArg(args.newPath) || "?"}`;
}

function formatShellTarget(args: Record<string, unknown>): string {
  const command = stringArg(args.command);
  if (command) return truncate(command, 80);

  const commands = Array.isArray(args.commands) ? args.commands.filter(isString) : [];
  const nonEmptyCommands = commands.filter((value) => value.trim() !== "");
  const firstCommand = nonEmptyCommands[0];
  if (!firstCommand) return "shell";
  const suffix = nonEmptyCommands.length > 1 ? ` (+${nonEmptyCommands.length - 1})` : "";
  return truncate(`${firstCommand}${suffix}`, 80);
}

function getLineRange(metadata: Record<string, unknown> | undefined): string {
  const snippet = getSnippetLike(metadata?.snippet) ?? getSnippetLike(metadata?.scope);
  if (!snippet) {
    return "";
  }
  return ` L${snippet.startLine}-${snippet.endLine}`;
}

function getMetadataPath(metadata: Record<string, unknown> | undefined): string | undefined {
  const snippet = getSnippetLike(metadata?.snippet) ?? getSnippetLike(metadata?.scope);
  if (typeof snippet?.filePath === "string") {
    return snippet.filePath;
  }
  return typeof metadata?.filePath === "string" ? metadata.filePath : undefined;
}

function getSnippetLike(value: unknown): { filePath?: string; startLine: number; endLine: number } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.startLine !== "number" || typeof value.endLine !== "number") {
    return undefined;
  }
  return {
    filePath: typeof value.filePath === "string" ? value.filePath : undefined,
    startLine: value.startLine,
    endLine: value.endLine,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function formatPath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolutePath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return relative || ".";
  }
  return filePath;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
