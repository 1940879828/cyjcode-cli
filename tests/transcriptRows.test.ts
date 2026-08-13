import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTranscriptRows,
  wrapTextByColumns,
} from "../src/ui/transcriptRows.js";
import type { AssistantTurn } from "../src/ui/assistantTurn.js";
import type { ChatEntry } from "../src/ui/hooks/index.js";

const SELECTION_HINT = "  提示: 可滚轮浏览内容，按住 Shift 拖拽选择文字";

test("wraps plain English by terminal columns", () => {
  assert.deepEqual(wrapTextByColumns("hello world", 5), ["hello", " worl", "d"]);
});

test("wraps Chinese by display width", () => {
  assert.deepEqual(wrapTextByColumns("你好世界", 4), ["你好", "世界"]);
});

test("keeps emoji graphemes together while wrapping", () => {
  assert.deepEqual(wrapTextByColumns("a🙂b", 3), ["a🙂", "b"]);
});

test("wraps long words without relying on whitespace", () => {
  assert.deepEqual(wrapTextByColumns("abcdefghij", 4), ["abcd", "efgh", "ij"]);
});

test("preserves empty lines", () => {
  assert.deepEqual(wrapTextByColumns("one\n\nthree", 10), ["one", "", "three"]);
});

test("builds stable transcript row order", () => {
  const assistantTurn: AssistantTurn = {
    id: "assistant_1",
    role: "assistant",
    parts: [
      { id: "assistant_text", kind: "text", content: "hello" },
      { id: "assistant_tool", kind: "tool", content: '👀读取文件"src/a.ts" L1-2' },
    ],
    activeText: "done",
    timestamp: 2,
  };
  const entries: ChatEntry[] = [
    {
      id: "user_1",
      role: "user",
      content: "question",
      timestamp: 1,
    },
    assistantTurn,
  ];

  const rows = buildTranscriptRows({
    entries,
    streamingReasoning: "thinking",
    streamingAssistantTurn: null,
    width: 80,
  });

  assert.deepEqual(
    rows.map((row) => ({ kind: row.kind, text: row.text })),
    [
      { kind: "user", text: "❯ question" },
      { kind: "assistant", text: "● hello" },
      { kind: "tool", text: '  👀读取文件"src/a.ts" L1-2' },
      { kind: "assistant", text: "● done" },
      { kind: "spacer", text: "" },
      { kind: "spacer", text: "" },
      { kind: "thinking", text: "Thinking: thinking" },
      { kind: "spacer", text: "" },
    ],
  );
});

test("adds header rows before chat history", () => {
  const rows = buildTranscriptRows({
    header: {
      version: "0.1.0",
      model: "deepseek-v4-pro",
      thinking: true,
      reasoningEffort: "max",
      path: "D:\\Project\\Agent\\tigacode-cli",
    },
    entries: [
      {
        id: "user_1",
        role: "user",
        content: "hello",
        timestamp: 1,
      },
    ],
    streamingReasoning: "",
    streamingAssistantTurn: null,
    width: 80,
  });

  assert.equal(rows[0]?.kind, "header");
  assert.equal(rows[0]?.text.startsWith("╭"), true);
  assert.equal(rows[1]?.segments?.some((segment) => segment.color === "#E24B5A"), true);
  assert.equal(rows[1]?.segments?.some((segment) => segment.color === "#55A8E8"), true);
  assert.equal(rows.at(-1)?.text, "❯ hello");
});

test("adds selection hint only to completed thinking rows", () => {
  const rows = buildTranscriptRows({
    entries: [
      {
        id: "thinking_1",
        role: "thinking",
        content: "done thinking",
        timestamp: 1,
      },
    ],
    streamingReasoning: "still thinking",
    streamingAssistantTurn: null,
    width: 80,
  });

  assert.deepEqual(
    rows.map((row) => ({ kind: row.kind, text: row.text })),
    [
      { kind: "spacer", text: "" },
      { kind: "thinking", text: "Thinking: done thinking" },
      { kind: "thinking", text: SELECTION_HINT },
      { kind: "spacer", text: "" },
      { kind: "spacer", text: "" },
      { kind: "thinking", text: "Thinking: still thinking" },
      { kind: "spacer", text: "" },
    ],
  );
});

test("does not show selection hint without completed thinking", () => {
  const rows = buildTranscriptRows({
    entries: [
      {
        id: "user_1",
        role: "user",
        content: "hello",
        timestamp: 1,
      },
    ],
    streamingReasoning: "",
    streamingAssistantTurn: null,
    width: 80,
  });

  assert.equal(rows.some((row) => row.text === SELECTION_HINT), false);
});

test("shows reasoning effort when thinking is enabled", () => {
  const rows = buildTranscriptRows({
    header: {
      version: "0.1.0",
      model: "deepseek-v4-pro",
      thinking: true,
      reasoningEffort: "high",
      path: "D:\\Project",
    },
    entries: [],
    streamingReasoning: "",
    streamingAssistantTurn: null,
    width: 80,
  });

  const effortRow = rows.find((row) => row.text.includes("Reasoning Effort"));
  assert.equal(effortRow?.text.includes("high"), true);
});

test("shows N/A for reasoning effort when thinking is disabled", () => {
  const rows = buildTranscriptRows({
    header: {
      version: "0.1.0",
      model: "deepseek-v4-pro",
      thinking: false,
      reasoningEffort: "high",
      path: "D:\\Project",
    },
    entries: [],
    streamingReasoning: "",
    streamingAssistantTurn: null,
    width: 80,
  });

  const effortRow = rows.find((row) => row.text.includes("Reasoning Effort"));
  assert.equal(effortRow?.text.includes("N/A"), true);
});
