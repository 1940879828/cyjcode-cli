import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import listDir from "../src/tools/listDir.js";
import rename from "../src/tools/rename.js";
import search from "../src/tools/search.js";
import write from "../src/tools/write.js";

test("file tools reject sibling directories with the same prefix", () => {
  withWorkspace((workspace) => {
    const sibling = `${workspace}-sibling`;
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(workspace, "inside.txt"), "hello\n", "utf-8");

    const outsideFile = path.join(sibling, "escape.txt");

    assertRejectsTraversal(write.execute({ filePath: outsideFile, content: "x" }));
    assertRejectsTraversal(listDir.execute({ path: sibling }));
    assertRejectsTraversal(search.execute({ pattern: "hello", path: sibling }));
    assertRejectsTraversal(rename.execute({ oldPath: "inside.txt", newPath: outsideFile }));
    assert.equal(fs.existsSync(outsideFile), false);
  });
});

test("file tools allow normal workspace paths", () => {
  withWorkspace(() => {
    assert.equal(write.execute({ filePath: "nested/inside.txt", content: "hello\n" }).success, true);
    assert.equal(listDir.execute({ path: ".", recursive: true }).success, true);
    assert.equal(search.execute({ pattern: "hello", path: "." }).success, true);
    assert.equal(rename.execute({ oldPath: "nested/inside.txt", newPath: "nested/renamed.txt" }).success, true);
    assert.equal(fs.existsSync(path.resolve("nested/renamed.txt")), true);
  });
});

test("search passes quoted patterns as arguments instead of shell text", () => {
  withWorkspace(() => {
    fs.writeFileSync(path.resolve("quoted.txt"), 'say "hello"\n', "utf-8");

    const result = search.execute({ pattern: '"hello"', path: "." });

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /quoted\.txt/);
  });
});

function assertRejectsTraversal(result: { success: boolean; error?: string }): void {
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /路径穿越拒绝/);
}

function withWorkspace(run: (workspace: string) => void): void {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-tools-"));
  try {
    process.chdir(workspace);
    run(workspace);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(`${workspace}-sibling`, { recursive: true, force: true });
  }
}
