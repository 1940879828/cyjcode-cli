import assert from "node:assert/strict";
import test from "node:test";
import {
  createInputBoxState,
  reduceInputBoxState,
  resolveInputBoxEvent,
  selectInputBoxView,
} from "../src/ui/components/InputBox/inputBoxModel.js";
import type {
  InputBoxEvent,
  InputKeyLike,
  InputBoxLayout,
  InputBoxState,
} from "../src/ui/components/InputBox/inputBoxModel.js";

const defaultLayout: InputBoxLayout = { inputColumns: 80 };

const applyEvent = (
  state: InputBoxState,
  event: InputBoxEvent,
  layout = defaultLayout,
) => reduceInputBoxState(state, event, layout);

const applyEvents = (
  events: InputBoxEvent[],
  layout = defaultLayout,
): InputBoxState =>
  events.reduce(
    (state, event) => applyEvent(state, event, layout).state,
    createInputBoxState(),
  );

const applyResolvedInput = (
  state: InputBoxState,
  input: string,
  key: InputKeyLike,
  layout = defaultLayout,
) => applyEvent(state, resolveInputBoxEvent(input, key), layout);

test("inserts text and normalizes pasted newlines", () => {
  const state = applyEvents([
    { type: "insertText", text: "hello" },
    { type: "insertText", text: "\r\nworld" },
  ]);

  assert.deepEqual(state.editor, {
    text: "hello\nworld",
    cursor: "hello\nworld".length,
  });
});
test("submit trims text, emits an effect, and resets the editor", () => {
  const state = applyEvents([{ type: "insertText", text: "  hello  " }]);
  const result = applyEvent(state, { type: "submit" });

  assert.deepEqual(result.effects, [{ type: "submit", text: "hello" }]);
  assert.deepEqual(result.state, createInputBoxState());
});

test("submit ignores blank input without clearing it", () => {
  const state = applyEvents([{ type: "insertText", text: "   " }]);
  const result = applyEvent(state, { type: "submit" });

  assert.deepEqual(result.effects, []);
  assert.equal(result.state.editor.text, "   ");
});

test("resolves enter shortcuts to submit or newline insert", () => {
  assert.deepEqual(resolveInputBoxEvent("", { return: true }), { type: "submit" });
  assert.deepEqual(resolveInputBoxEvent("", { return: true, shift: true }), {
    type: "insertText",
    text: "\n",
  });
  assert.deepEqual(resolveInputBoxEvent("", { return: true, meta: true }), {
    type: "insertText",
    text: "\n",
  });
});

test("resolved printable input inserts through the reducer", () => {
  const result = applyResolvedInput(createInputBoxState(), "你", {});

  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.state.editor, { text: "你", cursor: 1 });
});

test("supports backward and word deletion shortcuts", () => {
  const textState = applyEvents([{ type: "insertText", text: "hello world" }]);

  const backspace = applyEvent(
    textState,
    resolveInputBoxEvent("", { backspace: true }),
  ).state;
  assert.equal(backspace.editor.text, "hello worl");

  const wordBackspace = applyEvent(
    textState,
    resolveInputBoxEvent("", { backspace: true, ctrl: true }),
  ).state;
  assert.deepEqual(wordBackspace.editor, { text: "hello ", cursor: 6 });
});

test("supports forward and line deletion shortcuts", () => {
  const middleState: InputBoxState = { editor: { text: "abc", cursor: 1 } };

  assert.deepEqual(
    applyEvent(middleState, resolveInputBoxEvent("", { delete: true })).state.editor,
    { text: "ac", cursor: 1 },
  );
  assert.deepEqual(
    applyEvent(middleState, resolveInputBoxEvent("", { delete: true, meta: true })).state.editor,
    { text: "a", cursor: 1 },
  );
  assert.deepEqual(
    applyEvent({ editor: { text: "abc", cursor: 2 } }, resolveInputBoxEvent("u", { ctrl: true })).state.editor,
    { text: "c", cursor: 0 },
  );
});

test("resolved ctrl+k deletes from cursor to line end", () => {
  const state: InputBoxState = {
    editor: { text: "hello world", cursor: 6 },
  };
  const result = applyResolvedInput(state, "k", { ctrl: true });

  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.state.editor, { text: "hello ", cursor: 6 });
});

test("resolved meta+d deletes the next word", () => {
  const state: InputBoxState = {
    editor: { text: "hello world again", cursor: 6 },
  };
  const result = applyResolvedInput(state, "d", { meta: true });

  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.state.editor, { text: "hello  again", cursor: 6 });
});

test("resolved unknown ctrl shortcut leaves state unchanged", () => {
  const state: InputBoxState = {
    editor: { text: "hello", cursor: 5 },
  };
  const result = applyResolvedInput(state, "x", { ctrl: true });

  assert.deepEqual(result.effects, []);
  assert.equal(result.state, state);
});

test("supports home, end, arrow, and word movement", () => {
  const endState = applyEvents([{ type: "insertText", text: "hello world" }]);

  assert.equal(
    applyEvent(endState, resolveInputBoxEvent("", { leftArrow: true })).state.editor.cursor,
    10,
  );
  assert.equal(
    applyEvent(endState, resolveInputBoxEvent("", { leftArrow: true, ctrl: true })).state.editor.cursor,
    6,
  );
  assert.equal(
    applyEvent({ editor: { text: "hello world", cursor: 0 } }, resolveInputBoxEvent("", { rightArrow: true, ctrl: true })).state.editor.cursor,
    6,
  );
  assert.equal(
    applyEvent({ editor: { text: "hello", cursor: 2 } }, resolveInputBoxEvent("", { home: true })).state.editor.cursor,
    0,
  );
  assert.equal(
    applyEvent({ editor: { text: "hello", cursor: 2 } }, resolveInputBoxEvent("", { end: true })).state.editor.cursor,
    5,
  );
});

test("moves vertically through wrapped lines", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const state = applyEvents([{ type: "insertText", text: "abcd ef" }], layout);

  assert.equal(
    applyEvent(state, resolveInputBoxEvent("", { upArrow: true }), layout).state.editor.cursor,
    3,
  );
  assert.equal(
    applyEvent({ editor: { text: "abcd ef", cursor: 3 } }, resolveInputBoxEvent("", { downArrow: true }), layout).state.editor.cursor,
    7,
  );
});

test("renders wrapped text, with the cursor as a reversed char when shown", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const state = applyEvents([{ type: "insertText", text: "abcd ef" }], layout);

  // 不显示光标时：纯文本（已换行）
  assert.equal(selectInputBoxView(state, layout).renderedText, "abcd\n ef");

  // 显示光标时：光标落在行尾，追加一个蓝色反色字符代表光标
  assert.equal(
    selectInputBoxView(state, layout, true).renderedText,
    "abcd\n ef\u001B[38;2;85;168;232m\u001B[7m \u001B[27m\u001B[39m",
  );
});
