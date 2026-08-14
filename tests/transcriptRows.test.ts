import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTranscriptEntryRows,
  buildTranscriptHeaderRows,
  buildTranscriptRows,
  buildTranscriptSources,
  buildTranscriptStreamingRows,
  wrapTextByColumns,
} from "../src/ui/components/TranscriptViewport/transcriptRows.js";
import type { AssistantTurn } from "../src/ui/assistantTurn.js";
import type { ChatEntry } from "../src/ui/hooks/index.js";

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
      { id: "assistant_tool_2", kind: "tool", content: "✓ 读取完成" },
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
      { kind: "spacer", text: "" },
      { kind: "assistant", text: "● hello" },
      { kind: "spacer", text: "" },
      { kind: "tool", text: '  👀读取文件"src/a.ts" L1-2' },
      { kind: "tool", text: "  ✓ 读取完成" },
      { kind: "spacer", text: "" },
      { kind: "assistant", text: "● done" },
      { kind: "spacer", text: "" },
      { kind: "thinking", text: "Thinking: thinking" },
      { kind: "spacer", text: "" },
    ],
  );
});

test("renders pending tool part as tool rows", () => {
  const rows = buildTranscriptEntryRows({
    entry: {
      id: "assistant_1",
      role: "assistant",
      parts: [{ id: "assistant_tool", kind: "tool", content: '⚙️运行命令"npm test" …' }],
      activeText: "",
      timestamp: 1,
    },
    width: 80,
  });

  assert.deepEqual(
    rows.map((row) => ({ kind: row.kind, text: row.text })),
    [
      { kind: "tool", text: '  ⚙️运行命令"npm test" …' },
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
  assert.equal(rows.some((row) => row.kind === "header" && row.text.startsWith("╭")), true);
  const titleRow = rows.find((row) =>
    row.segments?.some((segment) => segment.text.includes("Tiga")),
  );
  assert.equal(titleRow?.segments?.some((segment) => segment.color === "#E24B5A"), true);
  assert.equal(titleRow?.segments?.some((segment) => segment.color === "#55A8E8"), true);
  assert.equal(rows.some((row) => row.text === "❯ hello"), true);
  assert.equal(rows.at(-1)?.kind, "spacer");
});

test("does not add selection tips to completed thinking rows", () => {
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
      { kind: "thinking", text: "Thinking: done thinking" },
      { kind: "spacer", text: "" },
      { kind: "thinking", text: "Thinking: still thinking" },
      { kind: "spacer", text: "" },
    ],
  );
});

test("does not show selection tips without completed thinking", () => {
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

  assert.equal(rows.some((row) => row.text.includes("拖选文字")), false);
});

test("adds one spacer after a system command output block", () => {
  const rows = buildTranscriptRows({
    entries: [
      {
        id: "system_1",
        role: "system",
        content: "已设置 Reasoning Effort: low\n提示: Thinking 已关闭",
        timestamp: 1,
      },
      {
        id: "user_1",
        role: "user",
        content: "你觉得现在的ui目录需不需要整理",
        timestamp: 2,
      },
    ],
    streamingReasoning: "",
    streamingAssistantTurn: null,
    width: 80,
  });

  assert.deepEqual(
    rows.map((row) => ({ kind: row.kind, text: row.text })),
    [
      { kind: "system", text: "已设置 Reasoning Effort: low" },
      { kind: "system", text: "提示: Thinking 已关闭" },
      { kind: "spacer", text: "" },
      { kind: "user", text: "❯ 你觉得现在的ui目录需不需要整理" },
      { kind: "spacer", text: "" },
    ],
  );
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

test("split row builders match full transcript rows", () => {
  const header = {
    version: "0.1.0",
    model: "deepseek-v4-pro",
    thinking: true,
    reasoningEffort: "high",
    path: "D:\\Project",
  };
  const entry = createAssistantTurnFixture();
  const fullRows = buildTranscriptRows({
    header,
    entries: [entry],
    streamingReasoning: "thinking",
    streamingAssistantTurn: null,
    width: 80,
  });

  assert.deepEqual(fullRows, [
    ...buildTranscriptHeaderRows({ header, width: 80 }),
    ...buildTranscriptEntryRows({ entry, width: 80 }),
    ...buildTranscriptStreamingRows({
      streamingReasoning: "thinking",
      streamingAssistantTurn: null,
      width: 80,
    }),
  ]);
});

function createAssistantTurnFixture(): AssistantTurn {
  return {
    id: "assistant_split",
    role: "assistant",
    parts: [{ id: "assistant_split_text", kind: "text", content: "hello" }],
    activeText: "",
    timestamp: 1,
  };
}

test("wrapped rows carry source offsets into the original text", () => {
  const entry: ChatEntry = {
    id: "user_1",
    role: "user",
    content: "hello world",
    timestamp: 1,
  };
  const rows = buildTranscriptEntryRows({ entry, width: 10 });

  assert.equal(rows[0]?.text, "❯ hello wo");
  assert.deepEqual(rows[0]?.source, {
    sourceId: "user_1",
    startOffset: 0,
    endOffset: 8,
    prefix: "❯ ",
  });
  assert.equal(rows[1]?.text, "  rld");
  assert.deepEqual(rows[1]?.source, {
    sourceId: "user_1",
    startOffset: 8,
    endOffset: 11,
    prefix: "  ",
  });
});

test("every source row reconstructs its fragment from the original text", () => {
  const content = "line one\nline two";
  const entry: ChatEntry = {
    id: "user_1",
    role: "user",
    content,
    timestamp: 1,
  };
  const rows = buildTranscriptEntryRows({ entry, width: 40 });
  const sourceRows = rows.filter((row) => row.source);

  for (const row of sourceRows) {
    const rowSource = row.source!;
    assert.equal(
      row.text,
      rowSource.prefix + content.slice(rowSource.startOffset, rowSource.endOffset),
    );
  }
  // 同一单元的物理行首尾相接（跨逻辑行时偏移跳过换行符）
  assert.deepEqual(
    sourceRows.map((row) => [row.source!.startOffset, row.source!.endOffset]),
    [[0, 8], [9, 17]],
  );
});

test("builds source units in row order from entries and streaming content", () => {
  const entries: ChatEntry[] = [
    { id: "user_1", role: "user", content: "question", timestamp: 1 },
    {
      id: "assistant_1",
      role: "assistant",
      parts: [{ id: "assistant_text", kind: "text", content: "hello" }],
      activeText: "",
      timestamp: 2,
    },
  ];
  const liveTurn: AssistantTurn = {
    id: "assistant_2",
    role: "assistant",
    parts: [{ id: "assistant_2_text", kind: "text", content: "live" }],
    activeText: "active",
    timestamp: 3,
  };

  assert.deepEqual(
    buildTranscriptSources({
      entries,
      streamingReasoning: "thinking",
      streamingAssistantTurn: liveTurn,
    }),
    [
      { id: "user_1", text: "question" },
      { id: "assistant_text", text: "hello" },
      { id: "streaming_reasoning", text: "thinking" },
      { id: "assistant_2_text", text: "live" },
      { id: "assistant_2_active", text: "active" },
    ],
  );
});
