import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "../src/llm/types.js";
import { buildMessages } from "../src/agent/messageBuilder.js";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import type { AgentHistoryStore } from "../src/agent/runtime.js";

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

test("system prompt uses the injected workspace root", () => {
  const prompt = buildSystemPrompt("D:/project/example");

  assert.match(prompt, /当前工作目录: D:\/project\/example/);
});

test("message builder consumes explicit history messages", () => {
  const history = createMemoryHistory([{ role: "user", content: "hello" }]);

  assert.deepEqual(buildMessages("system", history.getMessages()), [
    { role: "system", content: "system" },
    { role: "user", content: "hello" },
  ]);
});

test("memory history can truncate aborted turns", () => {
  const history = createMemoryHistory([{ role: "user", content: "before" }]);
  const start = history.getLength();
  history.addMessage({ role: "assistant", content: "streaming" });

  history.truncate(start);

  assert.deepEqual(history.getMessages(), [{ role: "user", content: "before" }]);
});
