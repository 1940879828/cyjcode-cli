import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import edit from "../src/tools/edit.js";
import { lineRangeToOffsets } from "../src/tools/fileState.js";
import read from "../src/tools/read.js";
import type { ToolResult } from "../src/tools/types.js";

test("edit fails before a file is read", () => {
  const result = edit.execute({
    snippetId: "snippet_missing",
    oldString: "a",
    newString: "b",
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /未知的 snippetId/);
});

test("read returns a snippet id", () => {
  withWorkspace((workspace) => {
    const filePath = path.join(workspace, "sample.ts");
    fs.writeFileSync(filePath, "const answer = 1;\n", "utf-8");

    const result = read.execute({ filePath: "sample.ts" });
    const snippet = getSnippetMetadata(result);

    assert.equal(result.success, true);
    assert.match(snippet.id, /^snippet_/);
    assert.equal(snippet.startLine, 1);
    assert.equal(snippet.filePath, filePath);
  });
});

test("read rejects non-positive limits", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "sample.ts"), "const answer = 1;\n", "utf-8");

    const result = read.execute({ filePath: "sample.ts", limit: 0 });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /limit 必须是大于 0 的整数/);
  });
});

test("read reports an empty file without line-number filler", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "empty.ts"), "", "utf-8");

    const result = read.execute({ filePath: "empty.ts" });
    const snippet = getSnippetMetadata(result);

    assert.equal(result.success, true);
    assert.equal(result.data, "(空文件)");
    assert.equal(snippet.startLine, 1);
    assert.equal(snippet.endLine, 1);
  });
});

test("edit replaces one exact occurrence and updates the file", () => {
  withWorkspace((workspace) => {
    const filePath = path.join(workspace, "sample.ts");
    fs.writeFileSync(filePath, "const answer = 1;\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "const answer = 1;",
      newString: "const answer = 2;",
    });

    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "const answer = 2;\n");
    assert.match(String(result.metadata?.diffPreview), /const answer = 2/);
  });
});

test("edit fails when oldString is absent", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "sample.ts"), "const answer = 1;\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "missing",
      newString: "present",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /oldString 未在 snippet 范围内找到/);
  });
});

test("edit rejects non-unique oldString without replaceAll and returns candidates", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "sample.ts"), "let value = 1;\nlet value = 1;\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "let value = 1;",
      newString: "let value = 2;",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /不唯一/);
    assert.equal(Array.isArray(result.metadata?.candidates), true);
    assert.equal((result.metadata?.candidates as unknown[]).length, 2);
  });
});

test("edit replaces all matches when expectedOccurrences matches", () => {
  withWorkspace((workspace) => {
    const filePath = path.join(workspace, "sample.ts");
    fs.writeFileSync(filePath, "let value = 1;\nlet value = 1;\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "let value = 1;",
      newString: "let value = 2;",
      replaceAll: true,
      expectedOccurrences: 2,
    });

    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "let value = 2;\nlet value = 2;\n");
  });
});

test("edit rejects replaceAll when expectedOccurrences mismatches", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "sample.ts"), "a();\na();\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "a();",
      newString: "b();",
      replaceAll: true,
      expectedOccurrences: 3,
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /实际找到 2 处匹配/);
  });
});

test("edit rejects a mismatched filePath guard", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "a.ts"), "a();\n", "utf-8");
    fs.writeFileSync(path.join(workspace, "b.ts"), "b();\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "a.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      filePath: "b.ts",
      oldString: "a();",
      newString: "c();",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /不一致/);
  });
});

test("edit rejects files modified after read", () => {
  withWorkspace((workspace) => {
    const filePath = path.join(workspace, "sample.ts");
    fs.writeFileSync(filePath, "a();\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));
    fs.writeFileSync(filePath, "a();\nexternal();\n", "utf-8");

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "a();",
      newString: "b();",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /重新 read/);
  });
});

test("edit preserves CRLF line endings", () => {
  withWorkspace((workspace) => {
    const filePath = path.join(workspace, "sample.ts");
    fs.writeFileSync(filePath, "const a = 1;\r\nconst b = 2;\r\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      oldString: "const a = 1;",
      newString: "const a = 3;",
    });

    assert.equal(result.success, true);
    assert.equal(fs.readFileSync(filePath, "utf-8"), "const a = 3;\r\nconst b = 2;\r\n");
  });
});

test("edit rejects paths outside the workspace", () => {
  withWorkspace((workspace) => {
    fs.writeFileSync(path.join(workspace, "sample.ts"), "a();\n", "utf-8");
    const snippet = getSnippetMetadata(read.execute({ filePath: "sample.ts" }));

    const result = edit.execute({
      snippetId: snippet.id,
      filePath: path.join(os.tmpdir(), "outside-tigacode-edit-test.ts"),
      oldString: "a();",
      newString: "b();",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /路径穿越拒绝/);
  });
});

test("lineRangeToOffsets does not advance past content without a line ending", () => {
  assert.deepEqual(lineRangeToOffsets("line", 2, 2), { start: 4, end: 4 });
  assert.deepEqual(lineRangeToOffsets("line\n", 2, 2), { start: 5, end: 5 });
  assert.deepEqual(lineRangeToOffsets("line\r\n", 2, 2), { start: 6, end: 6 });
});

function withWorkspace(run: (workspace: string) => void): void {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-edit-"));
  try {
    process.chdir(workspace);
    run(workspace);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function getSnippetMetadata(result: ToolResult): {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
} {
  assert.equal(result.success, true);
  const metadata = result.metadata as {
    snippet?: {
      id?: unknown;
      filePath?: unknown;
      startLine?: unknown;
      endLine?: unknown;
    };
  };
  assert.equal(typeof metadata.snippet?.id, "string");
  assert.equal(typeof metadata.snippet.filePath, "string");
  assert.equal(typeof metadata.snippet.startLine, "number");
  assert.equal(typeof metadata.snippet.endLine, "number");
  return metadata.snippet as {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
  };
}
