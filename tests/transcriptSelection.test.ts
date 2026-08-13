import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSelectedText,
  buildSelectionRowRanges,
  createSourceIndexLookup,
  getUnitSelectionRange,
  getSourcePointAtCell,
  reduceTranscriptSelectionEvent,
  resolveSelectionBounds,
  splitRowBySelection,
  splitRowPartsBySelection,
  type TranscriptSelection,
} from "../src/ui/components/TranscriptViewport/transcriptSelection.js";
import type {
  TranscriptRow,
  TranscriptSourceUnit,
} from "../src/ui/components/TranscriptViewport/transcriptRows.js";

const source = (id: string, text: string): TranscriptSourceUnit => ({ id, text });

const sourceRow = (
  id: string,
  text: string,
  sourceId: string,
  startOffset: number,
  endOffset: number,
  prefix = "",
): TranscriptRow => ({
  id,
  kind: "user",
  text,
  source: { sourceId, startOffset, endOffset, prefix },
});

const point = (sourceId: string, offset: number) => ({ sourceId, offset });

test("start maps the mouse cell to a source offset, skipping the prefix", () => {
  // 前缀 "❯ " 占 2 列(❯ 为中性宽度计 1)；col 5 → cell 4 → 相对列 2 → offset 2
  const rows = [sourceRow("u0_0", "❯ hello", "u0", 0, 5, "❯ ")];
  const result = reduceTranscriptSelectionEvent({
    event: { action: "start", col: 5, row: 1 },
    selection: null,
    visibleRows: rows,
    sources: [source("u0", "hello")],
  });

  assert.deepEqual(result, {
    selection: { anchor: point("u0", 2), active: point("u0", 2) },
    copyText: null,
  });
});

test("start on decorative rows or outside the rows clears the selection", () => {
  const rows: TranscriptRow[] = [{ id: "spacer", kind: "spacer", text: "" }];
  const current: TranscriptSelection = {
    anchor: point("u0", 0),
    active: point("u0", 3),
  };

  assert.deepEqual(
    reduceTranscriptSelectionEvent({
      event: { action: "start", col: 1, row: 1 },
      selection: current,
      visibleRows: rows,
      sources: [source("u0", "hello")],
    }),
    { selection: null, copyText: null },
  );
  assert.deepEqual(
    reduceTranscriptSelectionEvent({
      event: { action: "start", col: 1, row: 99 },
      selection: current,
      visibleRows: rows,
      sources: [source("u0", "hello")],
    }),
    { selection: null, copyText: null },
  );
});

test("end copies the source text without prefixes or wrap artifacts", () => {
  const rows: TranscriptRow[] = [
    sourceRow("u0_0", "❯ hello", "u0", 0, 5, "❯ "),
    sourceRow("u0_1", "  world", "u0", 6, 11, "  "),
  ];
  const selection: TranscriptSelection = {
    anchor: point("u0", 0),
    active: point("u0", 10),
  };
  const result = reduceTranscriptSelectionEvent({
    event: { action: "end", col: 7, row: 2 },
    selection,
    visibleRows: rows,
    sources: [source("u0", "hello world")],
  });

  assert.equal(result.selection, null);
  // 折行产生的物理行不引入换行，复制的是原文切片
  assert.equal(result.copyText, "hello worl");
});

test("copy joins multiple source units with newlines", () => {
  const selection: TranscriptSelection = {
    anchor: point("u0", 3),
    active: point("u1", 4),
  };
  const result = reduceTranscriptSelectionEvent({
    event: { action: "end", col: 5, row: 1 },
    selection,
    visibleRows: [sourceRow("u1_0", "second", "u1", 0, 6, "")],
    sources: [source("u0", "hello world"), source("u1", "second line")],
  });

  assert.equal(result.copyText, "lo world\nseco");
});

test("end falls back to release coordinates when no motion events arrived", () => {
  const rows = [sourceRow("u0_0", "hello", "u0", 0, 5, "")];
  const pressedOnly: TranscriptSelection = {
    anchor: point("u0", 0),
    active: point("u0", 0),
  };
  const result = reduceTranscriptSelectionEvent({
    event: { action: "end", col: 4, row: 1 },
    selection: pressedOnly,
    visibleRows: rows,
    sources: [source("u0", "hello")],
  });

  assert.equal(result.selection, null);
  assert.equal(result.copyText, "hel");
});

test("end without a drag copies nothing", () => {
  const rows = [sourceRow("u0_0", "hello", "u0", 0, 5, "")];
  const click: TranscriptSelection = {
    anchor: point("u0", 2),
    active: point("u0", 2),
  };
  const result = reduceTranscriptSelectionEvent({
    event: { action: "end", col: 3, row: 1 },
    selection: click,
    visibleRows: rows,
    sources: [source("u0", "hello")],
  });

  assert.deepEqual(result, { selection: null, copyText: null });
});

test("resolves reversed anchors to ordered bounds and rejects missing sources", () => {
  const sources = [source("u0", "a"), source("u1", "b"), source("u2", "c")];
  const indexOf = createSourceIndexLookup(sources);
  const reversed: TranscriptSelection = {
    anchor: point("u2", 5),
    active: point("u0", 1),
  };

  assert.deepEqual(resolveSelectionBounds(reversed, indexOf), {
    startIndex: 0,
    endIndex: 2,
    startOffset: 1,
    endOffset: 5,
  });
  assert.equal(
    resolveSelectionBounds({ anchor: point("u0", 0), active: point("gone", 0) }, indexOf),
    null,
  );
});

test("computes per-unit ranges for multi-unit selections", () => {
  const bounds = {
    startIndex: 1,
    endIndex: 3,
    startOffset: 2,
    endOffset: 5,
  };

  assert.equal(getUnitSelectionRange(bounds, 0), null);
  assert.deepEqual(getUnitSelectionRange(bounds, 1), { from: 2, to: Number.POSITIVE_INFINITY });
  assert.deepEqual(getUnitSelectionRange(bounds, 2), { from: 0, to: Number.POSITIVE_INFINITY });
  assert.deepEqual(getUnitSelectionRange(bounds, 3), { from: 0, to: 5 });
  assert.equal(getUnitSelectionRange(bounds, 4), null);
});

test("projects source selection onto rows, including prefix cells", () => {
  const sources = [source("u0", "abcdef")];
  const rows: TranscriptRow[] = [
    sourceRow("u0_0", "❯ abcd", "u0", 0, 4, "❯ "),
    sourceRow("u0_1", "  ef", "u0", 4, 6, "  "),
  ];
  const selection: TranscriptSelection = {
    anchor: point("u0", 1),
    active: point("u0", 5),
  };

  assert.deepEqual(buildSelectionRowRanges(selection, sources, rows), new Map([
    ["u0_0", { fromCol: 3, toCol: 6 }],
    ["u0_1", { fromCol: 2, toCol: 3 }],
  ]));
});

test("excludes decorative rows and rows outside the selection", () => {
  const sources = [source("u0", "abcdef")];
  const rows: TranscriptRow[] = [
    { id: "header_0", kind: "header", text: "──" },
    sourceRow("u0_0", "abc", "u0", 0, 3, ""),
    sourceRow("u0_1", "def", "u0", 3, 6, ""),
  ];
  const selection: TranscriptSelection = {
    anchor: point("u0", 0),
    active: point("u0", 2),
  };

  assert.deepEqual(buildSelectionRowRanges(selection, sources, rows), new Map([
    ["u0_0", { fromCol: 0, toCol: 2 }],
  ]));
});

test("maps cell columns back to source offsets", () => {
  const row = sourceRow("u0_0", "❯ 中ab", "u0", 0, 4, "❯ ");
  // 前缀 "❯ " 占 2 列；cell 4 → 相对列 2 → 中(宽 2)之后、a 起点 → offset 1
  assert.deepEqual(getSourcePointAtCell(row, 4), point("u0", 1));
  // cell 5 → 相对列 3 → a 之后、b 起点 → offset 2
  assert.deepEqual(getSourcePointAtCell(row, 5), point("u0", 2));
  assert.equal(getSourcePointAtCell({ id: "x", kind: "spacer", text: "" }, 0), null);
});

test("splits a row into unselected/selected/unselected parts", () => {
  assert.deepEqual(splitRowBySelection("abcdef", { fromCol: 2, toCol: 4 }), [
    { text: "ab", selected: false },
    { text: "cd", selected: true },
    { text: "ef", selected: false },
  ]);
  assert.deepEqual(
    splitRowBySelection("hello", { fromCol: 0, toCol: Number.POSITIVE_INFINITY }),
    [{ text: "hello", selected: true }],
  );
  assert.deepEqual(splitRowBySelection("", { fromCol: 0, toCol: 1 }), [
    { text: "", selected: false },
  ]);
});

test("splits wide characters by cell columns, keeping boundary chars in the selection", () => {
  // 中占 2 列(0-1)，a 占 1 列(2)，b 占 1 列(3)；选中第 1-2 列应包含跨边界的 中 与 a
  assert.deepEqual(splitRowBySelection("中ab", { fromCol: 1, toCol: 3 }), [
    { text: "中a", selected: true },
    { text: "b", selected: false },
  ]);
});

test("selection overlay preserves segment styles", () => {
  const segmentedRow: TranscriptRow = {
    id: "h0",
    kind: "header",
    text: "ABCD",
    segments: [
      { text: "AB", color: "#E24B5A" },
      { text: "CD", bold: true },
    ],
  };

  assert.deepEqual(splitRowPartsBySelection(segmentedRow, { fromCol: 1, toCol: 3 }), [
    { text: "A", selected: false, color: "#E24B5A", bold: undefined, dimColor: undefined },
    { text: "B", selected: true, color: "#E24B5A", bold: undefined, dimColor: undefined },
    { text: "C", selected: true, color: undefined, bold: true, dimColor: undefined },
    { text: "D", selected: false, color: undefined, bold: true, dimColor: undefined },
  ]);
});

test("builds selected text from sources with cell-column extraction", () => {
  const sources = [source("r0", "❯ hi"), source("r1", "there")];
  const selection: TranscriptSelection = {
    anchor: point("r0", 2),
    active: point("r1", 4),
  };

  assert.equal(buildSelectedText(sources, selection), "hi\nther");
});
