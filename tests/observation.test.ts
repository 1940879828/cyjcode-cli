import assert from "node:assert/strict";
import test from "node:test";
import { observeHistory, shouldCompressHistory } from "../src/agent/observation.js";
import { createObservationStore } from "../src/agent/observationStore.js";
import type { ChatMessage, ToolCall } from "../src/llm/types.js";

test("small history is not compressed", () => {
  const history = [user("hello"), ...toolGroup("call_small", "read", "src/a.ts", "short")];
  const observed = observeHistory({ history, store: createObservationStore() });

  assert.equal(observed.compressed, false);
  assert.deepEqual(observed.messages, history);
});

test("old tool groups are masked without mutating history", () => {
  const history = [
    user("start"),
    ...toolGroup("call_old", "read", "src/agent/loop.ts", "old file content"),
    ...userMessages(25),
  ];
  const store = createObservationStore();
  const observed = observeHistory({ history, store });

  assert.equal(observed.compressed, true);
  assert.equal(observed.stats.masks, 1);
  assert.equal(observed.messages.some((message) => message.role === "tool"), false);
  assert.match(observed.messages[1]?.content ?? "", /recall_history/);
  assert.equal(history[2]?.role, "tool");
});

test("recent tool groups stay complete while older groups are masked", () => {
  const history = [
    ...toolGroup("call_old", "shell", "npm test", "old output"),
    ...userMessages(25),
    ...toolGroup("call_recent", "read", "src/current.ts", "fresh content"),
  ];
  const observed = observeHistory({ history, store: createObservationStore() });

  assert.equal(observed.compressed, true);
  assert.equal(observed.messages.at(-2)?.role, "assistant");
  assert.equal(observed.messages.at(-1)?.role, "tool");
  assert.equal(observed.messages.at(-1)?.tool_call_id, "call_recent");
});

test("read masks keep file source fingerprint", () => {
  const store = createObservationStore();
  const history = [...toolGroup("call_read", "read", "src/a.ts", "content"), ...userMessages(25)];
  const observed = observeHistory({ history, store });
  const mask = store.get(readMaskId(observed.messages[0]));

  assert.equal(mask?.source.kind, "file");
  assert.equal(mask?.source.kind === "file" && mask.source.filePath.endsWith("src/a.ts"), true);
  assert.equal(mask?.source.kind === "file" && mask.source.contentFingerprint, "fingerprint");
});

test("large old text without tool calls is masked", () => {
  const history = [user("x".repeat(9000)), ...userMessages(12)];
  const observed = observeHistory({ history, store: createObservationStore() });

  assert.equal(shouldCompressHistory(history), true);
  assert.equal(observed.compressed, true);
  assert.match(observed.messages[0]?.content ?? "", /recall_history/);
  assert.equal(observed.messages[0]?.role, "user");
});

test("budget mode masks medium old text even below single-message threshold", () => {
  const history = Array.from({ length: 120 }, (_, index) => user(`${index}:${"x".repeat(4000)}`));
  const observed = observeHistory({ history, store: createObservationStore() });

  assert.equal(observed.compressed, true);
  assert.equal(observed.stats.masks > 0, true);
  assert.equal(observed.stats.estimatedObservedTokens < observed.stats.estimatedOriginalTokens, true);
});

function user(content: string): ChatMessage {
  return { role: "user", content };
}

function userMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => user(`message ${index}`));
}

function toolGroup(
  id: string,
  name: string,
  target: string,
  content: string,
): ChatMessage[] {
  return [
    { role: "assistant", content: null, tool_calls: [toolCall(id, name, target)] },
    { role: "tool", name, tool_call_id: id, content: toolResult(target, content) },
  ];
}

function toolCall(id: string, name: string, target: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify({ filePath: target, command: target }) },
  };
}

function toolResult(filePath: string, content: string): string {
  return JSON.stringify({
    success: true,
    data: content,
    metadata: { snippet: snippet(filePath) },
  });
}

function snippet(filePath: string): Record<string, unknown> {
  return {
    id: "snippet_1",
    filePath,
    startLine: 1,
    endLine: 1,
    contentFingerprint: "fingerprint",
  };
}

function readMaskId(message: ChatMessage | undefined): string {
  const match = message?.content?.match(/mask_[a-f0-9]+/);
  assert.ok(match);
  return match[0];
}
