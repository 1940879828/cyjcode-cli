import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatMessage, StreamEvent, ToolCall } from "../src/llm/types.js";
import { runAgentLoop } from "../src/agent/loop.js";
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

function createCapturingStream(responses: StreamEvent[][]) {
  const requests: ChatMessage[][] = [];
  const streamChat = async function* (options: { messages: ChatMessage[] }): AsyncGenerator<StreamEvent> {
    requests.push(options.messages);
    for (const event of responses.shift() ?? [done(null)]) yield event;
  };
  return { requests, streamChat };
}

async function drainAgentLoop(
  userMessage: string,
  runtime: ReturnType<typeof createTransientAgentRuntime>,
  streamChat: ReturnType<typeof createCapturingStream>["streamChat"],
): Promise<void> {
  for await (const _event of runAgentLoop(userMessage, { runtime, streamChatOverride: streamChat })) {
    // Drain generator.
  }
}

function textDelta(content: string): StreamEvent {
  return { type: "text_delta", content };
}

function done(toolCalls: ToolCall[] | null): StreamEvent {
  return { type: "done", toolCalls };
}

function toolCall(id: string, name: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: "{}" },
  };
}

function isTurnIntakeMessage(message: ChatMessage): boolean {
  return typeof message.content === "string" && message.content.includes("<turn_intake>");
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

test("default runtime starts a fresh session without explicit session id", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-fresh-session-"));
  try {
    const first = createDefaultAgentRuntime({ workspaceRoot });
    first.history.addMessage({ role: "user", content: "previous session" });
    const second = createDefaultAgentRuntime({ workspaceRoot });

    assert.notEqual(second.sessionId, first.sessionId);
    assert.deepEqual(second.history.getMessages(), []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("default runtime restores history for an explicit session id", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-explicit-session-"));
  try {
    const first = createDefaultAgentRuntime({ workspaceRoot });
    first.history.addMessage({ role: "user", content: "resume me" });
    const second = createDefaultAgentRuntime({ workspaceRoot, sessionId: first.sessionId });

    assert.equal(second.sessionId, first.sessionId);
    assert.deepEqual(second.history.getMessages(), [{ role: "user", content: "resume me" }]);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
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

test("agent loop sends turn intake without persisting it to history", async () => {
  const runtime = createTransientAgentRuntime(process.cwd());
  const stream = createCapturingStream([[textDelta("完成"), done(null)]]);

  await drainAgentLoop("修一下白屏问题", runtime, stream.streamChat);

  const request = stream.requests[0] ?? [];
  assert.equal(request.some((message) => message.role === "user" && message.content === "修一下白屏问题"), true);
  assert.equal(request.some(isTurnIntakeMessage), true);
  assert.equal(runtime.history.getMessages().some(isTurnIntakeMessage), false);
});

test("agent loop keeps the same turn intake across tool turns", async () => {
  const runtime = createTransientAgentRuntime(process.cwd());
  const stream = createCapturingStream([
    [done([toolCall("call_1", "missing_tool")])],
    [textDelta("完成"), done(null)],
  ]);

  await drainAgentLoop("修一下白屏问题", runtime, stream.streamChat);

  assert.equal(stream.requests.length, 2);
  assert.equal(stream.requests.every((messages) => messages.some(isTurnIntakeMessage)), true);
  assert.equal(runtime.history.getMessages().filter(isTurnIntakeMessage).length, 0);
});
