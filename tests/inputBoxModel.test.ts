import assert from "node:assert/strict";
import test from "node:test";
import {
  createInputBoxState,
  getSubmittableText,
  reduceInputBoxState,
  resolveInputBoxCommand,
  selectInputBoxView,
} from "../src/ui/components/InputBox/inputBoxModel.js";
import type {
  InputBoxCommand,
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
    (state, event) => applyEvent(state, event, layout),
    createInputBoxState(),
  );

const applyCommand = (
  state: InputBoxState,
  command: InputBoxCommand,
  layout = defaultLayout,
): InputBoxState =>
  command.type === "edit" ? applyEvent(state, command.event, layout) : state;

const resolveEditEvent = (
  input: string,
  key: InputKeyLike,
): InputBoxEvent => {
  const command = resolveInputBoxCommand(input, key);
  if (command.type !== "edit") {
    throw new Error(`Expected edit command, got ${command.type}`);
  }
  return command.event;
};

const applyResolvedInput = (
  state: InputBoxState,
  input: string,
  key: InputKeyLike,
  layout = defaultLayout,
) => applyCommand(state, resolveInputBoxCommand(input, key), layout);

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
test("selects submittable text by trimming non-blank input", () => {
  const state = applyEvents([{ type: "insertText", text: "  hello  " }]);

  assert.equal(getSubmittableText(state), "hello");
});

test("ignores blank input as non-submittable", () => {
  const state = applyEvents([{ type: "insertText", text: "   " }]);

  assert.equal(getSubmittableText(state), null);
  assert.equal(state.editor.text, "   ");
});

test("resolves enter shortcuts to submit command or newline insert", () => {
  assert.deepEqual(resolveInputBoxCommand("", { return: true }), { type: "submit" });
  assert.deepEqual(resolveInputBoxCommand("", { return: true, shift: true }), {
    type: "edit",
    event: {
      type: "insertText",
      text: "\n",
    },
  });
  assert.deepEqual(resolveInputBoxCommand("", { return: true, meta: true }), {
    type: "edit",
    event: {
      type: "insertText",
      text: "\n",
    },
  });
});

test("resolved printable input inserts through the reducer", () => {
  const result = applyResolvedInput(createInputBoxState(), "你", {});

  assert.deepEqual(result.editor, { text: "你", cursor: 1 });
});

test("supports backward and word deletion shortcuts", () => {
  const textState = applyEvents([{ type: "insertText", text: "hello world" }]);

  const backspace = applyEvent(
    textState,
    resolveEditEvent("", { backspace: true }),
  );
  assert.equal(backspace.editor.text, "hello worl");

  const wordBackspace = applyEvent(
    textState,
    resolveEditEvent("", { backspace: true, ctrl: true }),
  );
  assert.deepEqual(wordBackspace.editor, { text: "hello ", cursor: 6 });
});

test("supports forward and line deletion shortcuts", () => {
  const middleState: InputBoxState = { editor: { text: "abc", cursor: 1 } };

  assert.deepEqual(
    applyResolvedInput(middleState, "", { delete: true }).editor,
    { text: "ac", cursor: 1 },
  );
  assert.deepEqual(
    applyResolvedInput(middleState, "", { delete: true, meta: true }).editor,
    { text: "a", cursor: 1 },
  );
  assert.deepEqual(
    applyResolvedInput({ editor: { text: "abc", cursor: 2 } }, "u", { ctrl: true }).editor,
    { text: "c", cursor: 0 },
  );
});

test("resolved ctrl+k deletes from cursor to line end", () => {
  const state: InputBoxState = {
    editor: { text: "hello world", cursor: 6 },
  };
  const result = applyResolvedInput(state, "k", { ctrl: true });

  assert.deepEqual(result.editor, { text: "hello ", cursor: 6 });
});

test("resolved meta+d deletes the next word", () => {
  const state: InputBoxState = {
    editor: { text: "hello world again", cursor: 6 },
  };
  const result = applyResolvedInput(state, "d", { meta: true });

  assert.deepEqual(result.editor, { text: "hello  again", cursor: 6 });
});

test("resolved unknown ctrl shortcut leaves state unchanged", () => {
  const state: InputBoxState = {
    editor: { text: "hello", cursor: 5 },
  };
  const result = applyResolvedInput(state, "x", { ctrl: true });

  assert.equal(result, state);
});

test("supports home, end, arrow, and word movement", () => {
  const endState = applyEvents([{ type: "insertText", text: "hello world" }]);

  assert.equal(
    applyEvent(endState, resolveEditEvent("", { leftArrow: true })).editor.cursor,
    10,
  );
  assert.equal(
    applyEvent(endState, resolveEditEvent("", { leftArrow: true, ctrl: true })).editor.cursor,
    6,
  );
  assert.equal(
    applyEvent({ editor: { text: "hello world", cursor: 0 } }, resolveEditEvent("", { rightArrow: true, ctrl: true })).editor.cursor,
    6,
  );
  assert.equal(
    applyEvent({ editor: { text: "hello", cursor: 2 } }, resolveEditEvent("", { home: true })).editor.cursor,
    0,
  );
  assert.equal(
    applyEvent({ editor: { text: "hello", cursor: 2 } }, resolveEditEvent("", { end: true })).editor.cursor,
    5,
  );
});

test("moves vertically through wrapped lines", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const state = applyEvents([{ type: "insertText", text: "abcd ef" }], layout);

  assert.equal(
    applyEvent(state, resolveEditEvent("", { upArrow: true }), layout).editor.cursor,
    3,
  );
  assert.equal(
    applyEvent({ editor: { text: "abcd ef", cursor: 3 } }, resolveEditEvent("", { downArrow: true }), layout).editor.cursor,
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
