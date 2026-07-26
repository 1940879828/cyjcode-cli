import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { Tool, ToolResult } from "./types.js";

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
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || ".";
    const fileTypes = args.fileTypes as string | undefined;

    if (!pattern) {
      return {
        success: false,
        error: "pattern 参数不能为空",
      };
    }

    // 安全检查
    const resolved = path.resolve(searchPath);
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      return {
        success: false,
        error: `路径穿越拒绝: ${searchPath}`,
      };
    }

    try {
      if (!fs.existsSync(resolved)) {
        return {
          success: false,
          error: `路径不存在: ${searchPath}`,
        };
      }

      // 尝试使用 rg (ripgrep)
      try {
        const globFlag = fileTypes
          ? fileTypes
              .split(",")
              .map((t) => `-g '*${t.trim()}'`)
              .join(" ")
          : "";
        const cmd = `rg --line-number --no-heading "${pattern}" "${resolved}" ${globFlag}`;
        const result = execSync(cmd, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 10000,
        });
        return {
          success: true,
          data: result.trim() || "没有找到匹配项",
        };
      } catch (rgError) {
        // rg 不可用或没有结果，回退到 Node 原生搜索
      }

      // 回退：使用 fs 递归搜索
      const results: string[] = [];
      const searchRecursive = (dir: string) => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // 跳过 node_modules 和 .git
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            searchRecursive(fullPath);
          } else if (entry.isFile()) {
            // 检查文件类型过滤
            if (fileTypes) {
              const ext = path.extname(entry.name);
              const allowed = fileTypes.split(",").map((t) => t.trim());
              if (!allowed.includes(ext)) continue;
            }
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              const lines = content.split("\n");
              const regex = new RegExp(pattern, "gi");
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  results.push(
                    `${path.relative(cwd, fullPath)}:${i + 1}: ${lines[i].trim().substring(0, 200)}`
                  );
                  regex.lastIndex = 0; // 重置
                }
              }
            } catch {
              // 跳过无法读取的文件
            }
          }
        }
      };

      searchRecursive(resolved);
      return {
        success: true,
        data:
          results.length > 0
            ? results.slice(0, 100).join("\n")
            : "没有找到匹配项",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default search;
