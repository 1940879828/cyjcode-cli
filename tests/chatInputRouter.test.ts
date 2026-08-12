import assert from "node:assert/strict";
import test from "node:test";
import {
  getMouseScrollActions,
  routeChatInput,
  stripMouseInput,
} from "../src/ui/hooks/useChatInputRouter.js";

test("parses SGR wheel events into transcript scroll actions", () => {
  assert.deepEqual(getMouseScrollActions("\u001b[<64;18;22M", 5), [
    { type: "lineUp", amount: 5 },
  ]);
  assert.deepEqual(getMouseScrollActions("[<65;18;22M", 5), [
    { type: "lineDown", amount: 5 },
  ]);
});

test("consumes mouse clicks without routing to input", () => {
  assert.deepEqual(
    routeChatInput("<0;18;22M", {}, {
      isStreaming: false,
      isTranscriptPinnedToBottom: true,
      wheelRows: 5,
    }),
    { type: "mouse" },
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
  assert.equal(stripMouseInput("\u001b[<64;18;22M"), "");
  assert.equal(stripMouseInput("[<64;18;22;1M"), "");
  assert.equal(stripMouseInput("<0;18;22M<0;18;22m"), "");
  assert.equal(stripMouseInput("hello<65;22;8M"), "hello");
});
