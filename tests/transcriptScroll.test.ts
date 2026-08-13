import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranscriptScrollState,
  isPinnedToBottom,
  reconcileTranscriptScroll,
  scrollTranscript,
  scrollTranscriptHalfPage,
  selectVisibleTranscriptRows,
} from "../src/ui/components/TranscriptViewport/transcriptScroll.js";

test("keeps pinned viewport at bottom when content grows", () => {
  const state = createTranscriptScrollState(10);
  const next = reconcileTranscriptScroll(state, 12, 5);

  assert.equal(next.offsetFromBottom, 0);
  assert.equal(isPinnedToBottom(next), true);
});

test("preserves user position when content grows while not pinned", () => {
  const scrolled = scrollTranscript(
    createTranscriptScrollState(10),
    { type: "lineUp", amount: 2 },
    5,
  );
  const next = reconcileTranscriptScroll(scrolled, 13, 5);

  assert.equal(next.offsetFromBottom, 5);
});

test("supports page and boundary scrolling", () => {
  const state = createTranscriptScrollState(20);
  const pageUp = scrollTranscript(state, { type: "pageUp" }, 5);
  const top = scrollTranscript(pageUp, { type: "top" }, 5);
  const pageDown = scrollTranscript(top, { type: "pageDown" }, 5);
  const bottom = scrollTranscript(pageDown, { type: "bottom" }, 5);

  assert.equal(pageUp.offsetFromBottom, 4);
  assert.equal(top.offsetFromBottom, 15);
  assert.equal(pageDown.offsetFromBottom, 11);
  assert.equal(bottom.offsetFromBottom, 0);
});

test("supports half page scrolling", () => {
  const state = createTranscriptScrollState(20);
  const up = scrollTranscriptHalfPage(state, "up", 6);
  const down = scrollTranscriptHalfPage(up, "down", 6);

  assert.equal(up.offsetFromBottom, 3);
  assert.equal(down.offsetFromBottom, 0);
});

test("selects visible rows from offset from bottom", () => {
  const rows = ["0", "1", "2", "3", "4", "5"];
  const state = {
    offsetFromBottom: 2,
    totalRows: rows.length,
  };

  assert.deepEqual(selectVisibleTranscriptRows(rows, state, 3), ["1", "2", "3"]);
});
