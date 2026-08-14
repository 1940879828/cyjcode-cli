import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { formatToolDisplay, formatToolErrorDisplay } from "../src/ui/toolDisplay.js";

test("formats read display with file and line range from snippet metadata", () => {
  const result = formatToolDisplay({
    name: "read",
    arguments: { filePath: "src/index.ts", limit: 20 },
    result: {
      success: true,
      data: "1: code",
      metadata: {
        snippet: {
          id: "snippet_1",
          filePath: path.join(process.cwd(), "src/index.ts"),
          startLine: 1,
          endLine: 20,
        },
      },
    },
  });

  assert.equal(result, '👀读取文件"src\\index.ts" L1-20');
});

test("formats edit display with file and line range from result metadata", () => {
  const result = formatToolDisplay({
    name: "edit",
    arguments: { snippetId: "snippet_1" },
    result: {
      success: true,
      data: "成功替换 1 处匹配",
      metadata: {
        snippet: {
          id: "snippet_2",
          filePath: path.join(process.cwd(), "src/index.ts"),
          startLine: 4,
          endLine: 8,
        },
      },
    },
  });

  assert.equal(result, '✍️编辑文件"src\\index.ts" L4-8');
});

test("formats search display without result body", () => {
  const result = formatToolDisplay({
    name: "search",
    arguments: { pattern: "hello", path: "src" },
    result: {
      success: true,
      data: "src/index.ts:1: hello",
    },
  });

  assert.equal(result, '🔍搜索文件"src"');
});

test("formats search display with default search path", () => {
  const result = formatToolDisplay({
    name: "search",
    arguments: { pattern: "hello" },
    result: {
      success: true,
      data: "src/index.ts:1: hello",
    },
  });

  assert.equal(result, '🔍搜索文件"."');
});

test("formats shell display with command lists", () => {
  const result = formatToolDisplay({
    name: "shell",
    arguments: { commands: ["npm run typecheck", "npm run test:shell"] },
    result: { success: true },
  });

  assert.equal(result, '⚙️运行命令"npm run typecheck (+1)"');
});

test("formats tool errors as one compact line", () => {
  const result = formatToolErrorDisplay({
    name: "read",
    arguments: { filePath: "missing.ts" },
    result: {
      success: false,
      error: "文件不存在",
    },
  });

  assert.equal(result, '👀读取文件"missing.ts" 失败: 文件不存在');
});
