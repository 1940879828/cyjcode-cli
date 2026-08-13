import fs from "node:fs";
import path from "node:path";
import type { Tool, ToolResult } from "./types.js";
import { isInsideWorkspace } from "./workspacePath.js";
import { parseSearchArgs } from "./search/searchArgs.js";
import { globWithNode, grepWithNode } from "./search/nodeFallbackSearch.js";
import { globWithRipgrep, grepWithRipgrep } from "./search/ripgrepSearch.js";
import { DEFAULT_MAX_RESULTS, MAX_RESULTS_LIMIT, type SearchArgs } from "./search/searchTypes.js";

const search = {
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
} satisfies Tool;

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
  return rgResult ?? grepWithNode(args);
}

function runGlob(args: SearchArgs): ToolResult {
  if (!fs.statSync(args.resolvedPath).isDirectory()) {
    return { success: false, error: `glob 搜索路径必须是目录: ${args.searchPath}` };
  }
  if (path.isAbsolute(args.pattern)) {
    return { success: false, error: "glob pattern 必须相对搜索路径" };
  }

  const rgResult = globWithRipgrep(args);
  return rgResult ?? globWithNode(args);
}

export default search;
