import assert from "node:assert/strict";
import test from "node:test";
import { routeChatInput } from "../src/ui/hooks/useChatInputRouter.js";
import {
  getMouseBatchActions,
  hasMouseInput,
  stripMouseInput,
} from "../src/ui/hooks/terminalMouse.js";

test("parses shift-modified wheel events into scroll actions", () => {
  assert.deepEqual(getMouseBatchActions("\x1b[<68;18;22M", 5), [
    { kind: "scroll", action: { type: "lineUp", amount: 5 } },
  ]);
  assert.deepEqual(getMouseBatchActions("[<69;18;22M", 5), [
    { kind: "scroll", action: { type: "lineDown", amount: 5 } },
  ]);
});

test("consumes plain wheel events to keep selection mode", () => {
  assert.deepEqual(getMouseBatchActions("\x1b[<64;18;22M", 5), [{ kind: "ignore" }]);
  assert.deepEqual(
    routeChatInput("\x1b[<65;18;22M", {}, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "mouseBatch", actions: [{ kind: "ignore" }] },
  );
});

test("parses left-button press/drag/release into select events", () => {
  assert.deepEqual(getMouseBatchActions("\x1b[<0;18;22M", 5), [
    { kind: "select", event: { action: "start", col: 18, row: 22 } },
  ]);
  assert.deepEqual(getMouseBatchActions("\x1b[<32;20;22M", 5), [
    { kind: "select", event: { action: "extend", col: 20, row: 22 } },
  ]);
  assert.deepEqual(getMouseBatchActions("\x1b[<0;18;22m", 5), [
    { kind: "select", event: { action: "end", col: 18, row: 22 } },
  ]);
  assert.deepEqual(getMouseBatchActions("\x1b[<3;18;22m", 5), [
    { kind: "select", event: { action: "end", col: 18, row: 22 } },
  ]);
});

test("keeps every event in a mixed batch in order", () => {
  assert.deepEqual(getMouseBatchActions("\x1b[<0;18;22M\x1b[<32;20;22M\x1b[<64;20;22M", 5), [
    { kind: "select", event: { action: "start", col: 18, row: 22 } },
    { kind: "select", event: { action: "extend", col: 20, row: 22 } },
    { kind: "ignore" },
  ]);
});

test("consumes non-left mouse buttons without routing to input", () => {
  assert.deepEqual(
    routeChatInput("<1;18;22M", {}, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "mouseBatch", actions: [{ kind: "ignore" }] },
  );
});

test("routes legacy mouse bytes to the mouse sink", () => {
  assert.equal(hasMouseInput("\x1b[Mabc"), true);
  assert.deepEqual(
    routeChatInput("\x1b[Mabc", {}, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "mouse" },
  );
});

test("routes idle shift-wheel events to transcript scroll and idle text to input", () => {
  assert.deepEqual(
    routeChatInput("\x1b[<69;18;22M", {}, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "mouseBatch", actions: [{ kind: "scroll", action: { type: "lineDown", amount: 5 } }] },
  );
  assert.deepEqual(
    routeChatInput("hello", {}, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "input", input: "hello", key: {} },
  );
});

test("routes page keys to transcript scrolling", () => {
  assert.deepEqual(
    routeChatInput("", { pageUp: true }, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "scroll", actions: [{ type: "pageUp" }] },
  );
  assert.deepEqual(
    routeChatInput("", { pageDown: true }, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "scroll", actions: [{ type: "pageDown" }] },
  );
});

test("keeps edit shortcuts for input while idle and transcript while streaming", () => {
  assert.deepEqual(
    routeChatInput("", { home: true }, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "input", input: "", key: { home: true } },
  );
  assert.deepEqual(
    routeChatInput("", { home: true }, {
      isStreaming: true,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "scroll", actions: [{ type: "top" }] },
  );
  assert.deepEqual(
    routeChatInput("u", { ctrl: true }, {
      isStreaming: true,
      isTranscriptPinnedToBottom: true,
      wheelRows: 6,
    }),
    { type: "scroll", actions: [{ type: "lineUp", amount: 9 }] },
  );
});

test("ctrl+c has routing priority", () => {
  assert.deepEqual(
    routeChatInput("c", { ctrl: true, pageUp: true }, {
      isStreaming: true,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "exit" },
  );
});

test("routes End to bottom when transcript is not pinned", () => {
  assert.deepEqual(
    routeChatInput("", { end: true }, {
      isStreaming: false,
      isTranscriptPinnedToBottom: false,
      wheelRows: 5,
    }),
    { type: "scroll", actions: [{ type: "bottom" }] },
  );
  assert.deepEqual(
    routeChatInput("", { end: true }, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "input", input: "", key: { end: true } },
  );
});

test("strips mouse input across escape-prefixed and bare SGR forms", () => {
  assert.equal(stripMouseInput("\x1b[<64;18;22M"), "");
  assert.equal(stripMouseInput("[<64;18;22;1M"), "");
  assert.equal(stripMouseInput("<0;18;22M<0;18;22m"), "");
  assert.equal(stripMouseInput("hello<65;22;8M"), "hello");
});
