import assert from "node:assert/strict";
import test from "node:test";
import { assistantMessageContent, messagesToChatEntries } from "../src/ui/historyTranscript.js";
import { buildUserInputFocusMessage } from "../src/agent/userInputFocus.js";

test("messagesToChatEntries restores text roles", () => {
  const entries = messagesToChatEntries([
    { role: "system", content: "rules" },
    { role: "user", content: "hello" },
    { role: "tool", content: "done", name: "read", tool_call_id: "call_1" },
  ], deterministicOptions());

  assert.deepEqual(entries.map((entry) => entry.role), ["system", "user", "tool_result"]);
});

test("messagesToChatEntries restores assistant text as an assistant turn", () => {
  const [entry] = messagesToChatEntries([
    { role: "assistant", content: "answer" },
  ], deterministicOptions());

  assert.equal(entry?.role, "assistant");
  if (entry?.role !== "assistant") throw new Error("expected assistant entry");
  assert.deepEqual(entry.parts.map((part) => part.content), ["answer"]);
});

test("messagesToChatEntries hides internal user input focus messages", () => {
  const focusMessage = buildUserInputFocusMessage("实现输入关注笔记");
  assert.ok(focusMessage);

  const entries = messagesToChatEntries([
    { role: "user", content: "实现输入关注笔记" },
    focusMessage,
  ], deterministicOptions());

  assert.deepEqual(entries.map((entry) => entry.role), ["user"]);
});

test("assistantMessageContent summarizes assistant tool calls without text", () => {
  assert.equal(assistantMessageContent({
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } },
      { id: "call_2", type: "function", function: { name: "search_content", arguments: "{}" } },
    ],
  }), "工具调用: read_file, search_content");
});

function deterministicOptions() {
  let counter = 0;
  return {
    nextId: () => `id_${++counter}`,
    now: () => 1,
  };
}
