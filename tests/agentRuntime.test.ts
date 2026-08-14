import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatMessage } from "../src/llm/types.js";
import { buildMessages } from "../src/agent/messageBuilder.js";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import {
  createDefaultAgentRuntime,
  createTransientAgentRuntime,
  type AgentHistoryStore,
} from "../src/agent/runtime.js";

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

test("system prompt includes output format guidance", () => {
  const prompt = buildSystemPrompt("D:/project/example");

  assert.match(prompt, /输出格式:/);
  assert.match(prompt, /结论前置/);
  assert.match(prompt, /不以精简为名删信息/);
});

test("system prompt includes engineering judgment guidance", () => {
  const prompt = buildSystemPrompt("D:/project/example");

  assert.match(prompt, /第一性原理/);
  assert.match(prompt, /禁止症状遮蔽式工程/);
  assert.match(prompt, /temporary mitigation/);
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

test("default runtime rejects an explicit missing session id", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-missing-session-"));
  try {
    assert.throws(
      () => createDefaultAgentRuntime({ workspaceRoot, sessionId: "ses_missing" }),
      /会话不存在: ses_missing/,
    );
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("transient runtime keeps history in memory", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-transient-runtime-"));
  try {
    const runtime = createTransientAgentRuntime(workspaceRoot);
    runtime.history.addMessage({ role: "user", content: "devmock input" });

    assert.deepEqual(runtime.history.getMessages(), [{ role: "user", content: "devmock input" }]);
    assert.equal(fs.existsSync(path.join(workspaceRoot, ".tigacode")), false);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
