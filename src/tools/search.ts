import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { Tool, ToolResult } from "./types.js";
import { resolveInsideWorkspace } from "./workspacePath.js";

const search: Tool = {
  name: "search",
  description:
    "在文件中搜索指定的文本模式（支持正则表达式）。返回匹配的行及所在文件。",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "要搜索的文本或正则表达式模式",
      },
      path: {
        type: "string",
        description: "搜索路径，相对于当前工作目录。默认为当前目录 '.'",
        default: ".",
      },
      fileTypes: {
        type: "string",
        description:
          "限定文件类型，如 '.ts,.js,.json'。不指定则搜索所有文件",
      },
    },
    required: ["pattern"],
  },

  execute(args: Record<string, unknown>): ToolResult {
    const parsed = parseSearchArgs(args);

    if (!parsed.success) return { success: false, error: parsed.error };

    try {
      return searchFiles(parsed.value);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

interface SearchArgs {
  pattern: string;
  searchPath: string;
  fileTypes?: string;
  resolvedPath: string;
}

function parseSearchArgs(
  args: Record<string, unknown>,
): { success: true; value: SearchArgs } | { success: false; error: string } {
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  const searchPath = typeof args.path === "string" && args.path ? args.path : ".";
  const fileTypes = typeof args.fileTypes === "string" ? args.fileTypes : undefined;

  if (!pattern) return { success: false, error: "pattern 参数不能为空" };

  const resolved = resolveInsideWorkspace(searchPath);
  if (!resolved.success) return resolved;

  return {
    success: true,
    value: { pattern, searchPath, fileTypes, resolvedPath: resolved.path },
  };
}

function searchFiles(args: SearchArgs): ToolResult {
  if (!fs.existsSync(args.resolvedPath)) {
    return { success: false, error: `路径不存在: ${args.searchPath}` };
  }

  return searchWithRipgrep(args) ?? searchWithNode(args);
}

function searchWithRipgrep(args: SearchArgs): ToolResult | null {
  const result = spawnSync("rg", buildRipgrepArgs(args), {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 10000,
    windowsHide: true,
  });

  if (result.error || result.status === null || result.status > 1) return null;

  const output = result.stdout.trim();
  return { success: true, data: output || "没有找到匹配项" };
}

function buildRipgrepArgs(args: SearchArgs): string[] {
  const globs = parseFileTypes(args.fileTypes).flatMap((type) => ["-g", `*${type}`]);
  return ["--line-number", "--no-heading", args.pattern, args.resolvedPath, ...globs];
}

function searchWithNode(args: SearchArgs): ToolResult {
  const results = collectNodeSearchResults(args).slice(0, 100);
  return {
    success: true,
    data: results.length > 0 ? results.join("\n") : "没有找到匹配项",
  };
}

function collectNodeSearchResults(args: SearchArgs): string[] {
  const regex = new RegExp(args.pattern, "gi");
  return listSearchFiles(args.resolvedPath)
    .filter((filePath) => isAllowedFileType(filePath, args.fileTypes))
    .flatMap((filePath) => searchFile(filePath, regex));
}

function listSearchFiles(targetPath: string): string[] {
  if (fs.statSync(targetPath).isFile()) return [targetPath];

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && shouldSearchDirectory(entry.name)) {
      return listSearchFiles(path.join(targetPath, entry.name));
    }
    return entry.isFile() ? [path.join(targetPath, entry.name)] : [];
  });
}

function shouldSearchDirectory(name: string): boolean {
  return name !== "node_modules" && name !== ".git";
}

function isAllowedFileType(filePath: string, fileTypes: string | undefined): boolean {
  const allowedTypes = parseFileTypes(fileTypes);
  return allowedTypes.length === 0 || allowedTypes.includes(path.extname(filePath));
}

function parseFileTypes(fileTypes: string | undefined): string[] {
  return fileTypes
    ? fileTypes.split(",").map((type) => type.trim()).filter(Boolean)
    : [];
}

function searchFile(filePath: string, regex: RegExp): string[] {
  try {
    return fs.readFileSync(filePath, "utf-8")
      .split("\n")
      .flatMap((line, index) => formatMatch(filePath, line, index, regex));
  } catch {
    return [];
  }
}

function formatMatch(
  filePath: string,
  line: string,
  index: number,
  regex: RegExp,
): string[] {
  regex.lastIndex = 0;
  if (!regex.test(line)) return [];
  regex.lastIndex = 0;
  return [
    `${path.relative(process.cwd(), filePath)}:${index + 1}: ${line.trim().substring(0, 200)}`,
  ];
}

export default search;
