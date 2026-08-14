import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gitCommit, gitDiff, gitLog, gitStatus } from "../src/tools/git.js";

test("git_status reports branch and untracked files", async () => {
  await withGitRepo(async () => {
    fs.writeFileSync("note.txt", "hello\n", "utf-8");

    const result = await gitStatus.execute({});

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /^## /);
    assert.match(result.data ?? "", /\?\? note\.txt/);
  });
});

test("git_diff reads unstaged, staged, and all changes", async () => {
  await withGitRepo(async () => {
    writeAndCommit("note.txt", "before\n", "chore: seed");
    fs.writeFileSync("note.txt", "after\n", "utf-8");

    const unstaged = await gitDiff.execute({ mode: "unstaged", pathspecs: ["note.txt"] });
    assert.equal(unstaged.success, true);
    assert.match(unstaged.data ?? "", /-before/);
    assert.match(unstaged.data ?? "", /\+after/);

    git("add", "note.txt");
    const staged = await gitDiff.execute({ mode: "staged", stat: true });
    assert.equal(staged.success, true);
    assert.match(staged.data ?? "", /note\.txt/);

    const all = await gitDiff.execute({ mode: "all", contextLines: 0 });
    assert.equal(all.success, true);
    assert.match(all.data ?? "", /@@/);
  });
});

test("git_log returns recent commits with a safe limit", async () => {
  await withGitRepo(async () => {
    writeAndCommit("one.txt", "one\n", "feat: one");
    writeAndCommit("two.txt", "two\n", "fix: two");

    const result = await gitLog.execute({ limit: 1 });

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /fix: two/);
    assert.doesNotMatch(result.data ?? "", /feat: one/);
  });
});

test("git_commit stages selected paths and creates a commit", async () => {
  await withGitRepo(async () => {
    fs.writeFileSync("note.txt", "hello\n", "utf-8");

    const result = await gitCommit.execute({
      message: "feat: add note",
      pathspecs: ["note.txt"],
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata?.stage, "paths");
    assert.equal(typeof result.metadata?.commit, "string");
    assert.match(git("log", "--oneline", "-1"), /feat: add note/);
  });
});

test("git_commit pathspecs do not include unrelated staged files", async () => {
  await withGitRepo(async () => {
    fs.writeFileSync("selected.txt", "selected\n", "utf-8");
    fs.writeFileSync("staged.txt", "staged\n", "utf-8");
    git("add", "staged.txt");

    const result = await gitCommit.execute({
      message: "feat: selected only",
      pathspecs: ["selected.txt"],
    });

    assert.equal(result.success, true);
    assert.match(git("show", "--name-only", "--format=", "HEAD"), /^selected\.txt\s*$/);
    assert.match(git("status", "--short"), /^A  staged\.txt/m);
  });
});

test("git_commit rejects staged mode with pathspecs", async () => {
  await withGitRepo(async () => {
    const result = await gitCommit.execute({
      message: "feat: invalid",
      stage: "staged",
      pathspecs: ["note.txt"],
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /stage=staged/);
  });
});

test("git tools reject pathspecs outside the workspace", async () => {
  await withGitRepo(async (workspace) => {
    const outside = path.join(path.dirname(workspace), "outside.txt");

    const diffResult = await gitDiff.execute({ pathspecs: [outside] });
    const commitResult = await gitCommit.execute({
      message: "feat: outside",
      stage: "paths",
      pathspecs: [outside],
    });

    assert.equal(diffResult.success, false);
    assert.match(diffResult.error ?? "", /路径穿越拒绝/);
    assert.equal(commitResult.success, false);
    assert.match(commitResult.error ?? "", /路径穿越拒绝/);
  });
});

async function withGitRepo(run: (workspace: string) => Promise<void>): Promise<void> {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-git-"));
  try {
    process.chdir(workspace);
    git("init");
    git("config", "core.autocrlf", "false");
    git("config", "user.name", "Tiga Test");
    git("config", "user.email", "tiga@example.test");
    await run(workspace);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function writeAndCommit(filePath: string, content: string, message: string): void {
  fs.writeFileSync(filePath, content, "utf-8");
  git("add", filePath);
  git("commit", "-m", message);
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8" });
}
