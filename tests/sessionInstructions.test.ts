import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { addMessage, clearHistory, getMessages } from "../src/agent/history.js";
import { PROJECT_INSTRUCTIONS_FILE } from "../src/agent/projectInstructions.js";
import { appendProjectInstructionsToHistory } from "../src/agent/sessionInstructions.js";

afterEach(() => {
  clearHistory();
});

function createProjectFixture(content: string) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-session-agents-"));
  const nestedDir = path.join(rootDir, "src", "agent");
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, PROJECT_INSTRUCTIONS_FILE), content, "utf8");
  return { nestedDir };
}

test("appendProjectInstructionsToHistory stores AGENTS.md as a system message", () => {
  const { nestedDir } = createProjectFixture("\nproject rules\n");
  clearHistory();

  assert.equal(appendProjectInstructionsToHistory(nestedDir), true);
  assert.deepEqual(getMessages(), [
    { role: "system", content: "project rules" },
  ]);
});

test("appendProjectInstructionsToHistory does not duplicate instructions in an active history", () => {
  const { nestedDir } = createProjectFixture("project rules");
  clearHistory();
  addMessage({ role: "user", content: "hello" });

  assert.equal(appendProjectInstructionsToHistory(nestedDir), false);
  assert.deepEqual(getMessages(), [
    { role: "user", content: "hello" },
  ]);
});
