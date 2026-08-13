import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCachedTranscriptRows,
  createTranscriptRowsCache,
} from "../src/ui/transcriptRowsCache.js";
import type { ChatEntry } from "../src/ui/hooks/index.js";

test("reuses completed entry rows when appending new entries", () => {
  const cache = createTranscriptRowsCache();
  const firstEntry = createEntry("user_1", "first message");
  buildCachedTranscriptRows(cache, createInput([firstEntry]));
  const firstRows = cache.entryRowsById.get(firstEntry.id);

  const rows = buildCachedTranscriptRows(
    cache,
    createInput([firstEntry, createEntry("user_2", "second message")]),
  );

  assert.equal(cache.entryRowsById.get(firstEntry.id), firstRows);
  assert.equal(rows.some((row) => row.text.includes("second message")), true);
});

test("rebuilds only streaming rows when streaming content changes", () => {
  const cache = createTranscriptRowsCache();
  const entry = createEntry("user_1", "stable history");
  buildCachedTranscriptRows(cache, createInput([entry], "thinking"));
  const completedRows = cache.completedRows;

  const rows = buildCachedTranscriptRows(cache, createInput([entry], "thinking more"));

  assert.equal(cache.completedRows, completedRows);
  assert.equal(rows.some((row) => row.text.includes("thinking more")), true);
});

test("invalidates cached rows when width changes", () => {
  const cache = createTranscriptRowsCache();
  const entry = createEntry("user_1", "very long message");
  buildCachedTranscriptRows(cache, createInput([entry], "", 80));
  const wideRows = cache.entryRowsById.get(entry.id);

  buildCachedTranscriptRows(cache, createInput([entry], "", 10));

  assert.notEqual(cache.entryRowsById.get(entry.id), wideRows);
});

test("clears completed cache when history is cleared", () => {
  const cache = createTranscriptRowsCache();
  buildCachedTranscriptRows(cache, createInput([createEntry("user_1", "old")]));

  const rows = buildCachedTranscriptRows(cache, createInput([]));

  assert.equal(cache.entryRowsById.size, 0);
  assert.equal(rows.some((row) => row.text.includes("old")), false);
});

function createInput(
  entries: readonly ChatEntry[],
  streamingReasoning = "",
  width = 80,
) {
  return {
    entries,
    streamingReasoning,
    streamingAssistantTurn: null,
    width,
  };
}

function createEntry(id: string, content: string): ChatEntry {
  return {
    id,
    role: "user",
    content,
    timestamp: 1,
  };
}
