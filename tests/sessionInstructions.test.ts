import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentHistoryStore } from "../src/agent/runtime.js";
import { PROJECT_INSTRUCTIONS_FILE } from "../src/agent/projectInstructions.js";
import { appendProjectInstructionsToHistory } from "../src/agent/sessionInstructions.js";
import type { ChatMessage } from "../src/llm/types.js";

function createProjectFixture(content: string) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-session-agents-"));
  const nestedDir = path.join(rootDir, "src", "agent");
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, PROJECT_INSTRUCTIONS_FILE), content, "utf8");
  return { nestedDir };
}

test("appendProjectInstructionsToHistory stores AGENTS.md as a system message", () => {
  const { nestedDir } = createProjectFixture("\nproject rules\n");
  const history = createMemoryHistory();

  assert.equal(appendProjectInstructionsToHistory(nestedDir, history), true);
  assert.deepEqual(history.getMessages(), [
    { role: "system", content: "project rules" },
  ]);
});

test("appendProjectInstructionsToHistory does not duplicate instructions in an active history", () => {
  const { nestedDir } = createProjectFixture("project rules");
  const history = createMemoryHistory([{ role: "user", content: "hello" }]);

  assert.equal(appendProjectInstructionsToHistory(nestedDir, history), false);
  assert.deepEqual(history.getMessages(), [
    { role: "user", content: "hello" },
  ]);
});

function createMemoryHistory(messages: ChatMessage[] = []): AgentHistoryStore {
  return {
    addMessage: (message) => messages.push(message),
    getMessages: () => [...messages],
    getLength: () => messages.length,
    truncate: (length) => {
      messages.length = Math.max(0, Math.min(length, messages.length));
    },
  };
}
