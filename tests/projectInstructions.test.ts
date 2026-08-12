import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  findProjectInstructionsPath,
  loadProjectInstructions,
  PROJECT_INSTRUCTIONS_FILE,
} from "../src/agent/projectInstructions.js";

function createProjectFixture(content: string) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-agents-"));
  const nestedDir = path.join(rootDir, "src", "ui");
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, PROJECT_INSTRUCTIONS_FILE), content, "utf8");
  return { rootDir, nestedDir };
}

test("findProjectInstructionsPath searches from nested directories upward", () => {
  const { rootDir, nestedDir } = createProjectFixture("project rules");

  assert.equal(
    findProjectInstructionsPath(nestedDir),
    path.join(rootDir, PROJECT_INSTRUCTIONS_FILE),
  );
});

test("loadProjectInstructions returns trimmed AGENTS.md content", () => {
  const { rootDir } = createProjectFixture("\nproject rules\n");

  assert.deepEqual(loadProjectInstructions(rootDir), {
    filePath: path.join(rootDir, PROJECT_INSTRUCTIONS_FILE),
    content: "project rules",
  });
});

test("loadProjectInstructions ignores empty AGENTS.md files", () => {
  const { rootDir } = createProjectFixture("\n");

  assert.equal(loadProjectInstructions(rootDir), null);
});
