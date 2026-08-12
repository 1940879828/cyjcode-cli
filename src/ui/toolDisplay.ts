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

  switch (context.name) {
    case "read":
      return `👀读取文件"${target}"${range}`;
    case "edit":
      return `✍️编辑文件"${target}"${range}`;
    case "search":
      return `🔍搜索文件"${target}"`;
    case "write":
      return `✍️写入文件"${target}"`;
    case "rename":
      return `✍️重命名文件"${target}"`;
    case "listDir":
      return `📁查看目录"${target}"`;
    case "shell":
      return `⚙️运行命令"${target}"`;
    default:
      return `调用工具"${context.name}"`;
  }
}

export function formatToolErrorDisplay(context: ToolDisplayContext): string {
  return `${formatToolDisplay(context)} 失败: ${context.result.error ?? "未知错误"}`;
}

function getToolTarget(context: ToolDisplayContext): string {
  const metadataPath = getMetadataPath(context.result.metadata);
  if (metadataPath) {
    return formatPath(metadataPath);
  }

  if (context.name === "search") {
    return formatPath(stringArg(context.arguments.path) || ".");
  }

  if (context.name === "rename") {
    return `${stringArg(context.arguments.oldPath) || "?"} → ${stringArg(context.arguments.newPath) || "?"}`;
  }

  if (context.name === "shell") {
    return truncate(stringArg(context.arguments.command) || context.name, 80);
  }

  const target =
    stringArg(context.arguments.filePath) ||
    stringArg(context.arguments.path) ||
    stringArg(context.arguments.pattern) ||
    context.name;
  return formatPath(target);
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
