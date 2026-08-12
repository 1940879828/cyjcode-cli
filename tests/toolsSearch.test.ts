import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import search from "../src/tools/search.js";

test("search glob mode finds files by pattern", () => {
  withWorkspace(() => {
    fs.mkdirSync(path.resolve("src/nested"), { recursive: true });
    fs.writeFileSync(path.resolve("src/index.ts"), "export {}\n", "utf-8");
    fs.writeFileSync(path.resolve("src/nested/view.tsx"), "export {}\n", "utf-8");
    fs.writeFileSync(path.resolve("src/index.js"), "module.exports = {}\n", "utf-8");

    const result = search.execute({ mode: "glob", pattern: "**/*.{ts,tsx}", path: "src" });

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /src\/index\.ts/);
    assert.match(result.data ?? "", /src\/nested\/view\.tsx/);
    assert.doesNotMatch(result.data ?? "", /src\/index\.js/);
    assert.equal(result.metadata?.mode, "glob");
  });
});

test("search grep mode can return matching files only", () => {
  withWorkspace(() => {
    fs.mkdirSync(path.resolve("src"), { recursive: true });
    fs.writeFileSync(path.resolve("src/one.ts"), "needle\n", "utf-8");
    fs.writeFileSync(path.resolve("src/two.ts"), "haystack\nneedle\n", "utf-8");

    const result = search.execute({
      pattern: "needle",
      path: "src",
      outputMode: "files",
      maxResults: 1,
    });

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /src\/(one|two)\.ts/);
    assert.match(result.data ?? "", /结果已截断/);
    assert.equal(result.metadata?.outputMode, "files");
    assert.equal(result.metadata?.truncated, true);
  });
});

test("search grep handles patterns that start with a dash", () => {
  withWorkspace(() => {
    fs.writeFileSync(path.resolve("notes.txt"), "- todo\n", "utf-8");

    const result = search.execute({ pattern: "- todo", path: "." });

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /notes\.txt/);
  });
});

test("search rejects symlink paths that resolve outside the workspace", () => {
  withWorkspace((workspace) => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-search-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n", "utf-8");
      try {
        fs.symlinkSync(outside, path.join(workspace, "outside-link"), "dir");
      } catch {
        return;
      }

      const result = search.execute({ mode: "glob", pattern: "**/*.txt", path: "outside-link" });

      assert.equal(result.success, false);
      assert.match(result.error ?? "", /路径穿越拒绝/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

function withWorkspace(run: (workspace: string) => void): void {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-search-"));
  try {
    process.chdir(workspace);
    run(workspace);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
