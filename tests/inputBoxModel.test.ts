import assert from "node:assert/strict";
import test from "node:test";
import { stripMouseInput } from "../src/ui/hooks/useChatInputRouter.js";
import {
  appendInputHistory,
  createInputBoxState,
  getSubmittableText,
  isBlankInput,
  reduceInputBoxState,
  resolveInputBoxCommand,
  selectInputBoxView,
} from "../src/ui/components/InputBox/inputBoxModel.js";
import type {
  InputBoxCommand,
  InputBoxEvent,
  InputKeyLike,
  InputBoxLayout,
  InputBoxModelContext,
  InputBoxState,
} from "../src/ui/components/InputBox/inputBoxModel.js";

const defaultLayout: InputBoxLayout = { inputColumns: 80 };
const defaultContext: InputBoxModelContext = {
  layout: defaultLayout,
  inputHistory: [],
};

const createContext = (
  layout = defaultLayout,
  inputHistory: readonly string[] = [],
): InputBoxModelContext => ({ layout, inputHistory });

const createState = (text: string, cursor = text.length): InputBoxState => ({
  editor: { text, cursor },
  historyBrowsing: null,
});

const createHistoryState = ({
  text,
  index,
  draft,
  cursor = text.length,
}: {
  text: string;
  index: number;
  draft: string;
  cursor?: number;
}): InputBoxState => ({
  editor: { text, cursor },
  historyBrowsing: { index, draft },
});

const applyEvent = (
  state: InputBoxState,
  event: InputBoxEvent,
  context = defaultContext,
) => reduceInputBoxState(state, event, context);

const applyEvents = (
  events: InputBoxEvent[],
  context = defaultContext,
): InputBoxState =>
  events.reduce(
    (state, event) => applyEvent(state, event, context),
    createInputBoxState(),
  );

const applyCommand = (
  state: InputBoxState,
  command: InputBoxCommand,
  context = defaultContext,
): InputBoxState =>
  command.type === "edit"
    ? applyEvent(state, command.event, context)
    : state;

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
  action: { input?: string; key?: InputKeyLike },
  context = defaultContext,
) =>
  applyCommand(
    state,
    resolveInputBoxCommand(action.input ?? "", action.key ?? {}),
    context,
  );

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

test("selects submittable text without trimming formatting", () => {
  const state = applyEvents([{ type: "insertText", text: "  hello  " }]);

  assert.equal(getSubmittableText(state), "  hello  ");
});

test("ignores blank input as non-submittable", () => {
  const state = applyEvents([{ type: "insertText", text: "   " }]);

  assert.equal(isBlankInput(" \n\t"), true);
  assert.equal(isBlankInput("  hello  "), false);
  assert.equal(getSubmittableText(state), null);
  assert.equal(state.editor.text, "   ");
});

test("appends raw input history and skips only consecutive duplicates", () => {
  const first = appendInputHistory([], "  /help  ");
  assert.deepEqual(first, ["  /help  "]);

  assert.equal(appendInputHistory(first, "  /help  "), first);
  assert.equal(appendInputHistory(first, "   "), first);
  assert.deepEqual(
    appendInputHistory(first, "/help"),
    ["  /help  ", "/help"],
  );
  assert.deepEqual(appendInputHistory(["A", "B"], "A"), ["A", "B", "A"]);
});

test("resolves enter shortcuts to submit command or newline insert", () => {
  assert.deepEqual(resolveInputBoxCommand("", { return: true }), {
    type: "submit",
  });
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
  const result = applyResolvedInput(createInputBoxState(), { input: "你" });

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
  const middleState = createState("abc", 1);

  assert.deepEqual(
    applyResolvedInput(middleState, { key: { delete: true } }).editor,
    { text: "ac", cursor: 1 },
  );
  assert.deepEqual(
    applyResolvedInput(middleState, {
      key: { delete: true, meta: true },
    }).editor,
    { text: "a", cursor: 1 },
  );
  assert.deepEqual(
    applyResolvedInput(createState("abc", 2), {
      input: "u",
      key: { ctrl: true },
    }).editor,
    { text: "c", cursor: 0 },
  );
});

test("resolved ctrl+k deletes from cursor to line end", () => {
  const state = createState("hello world", 6);
  const result = applyResolvedInput(state, { input: "k", key: { ctrl: true } });

  assert.deepEqual(result.editor, { text: "hello ", cursor: 6 });
});

test("resolved meta+d deletes the next word", () => {
  const state = createState("hello world again", 6);
  const result = applyResolvedInput(state, { input: "d", key: { meta: true } });

  assert.deepEqual(result.editor, { text: "hello  again", cursor: 6 });
});

test("resolved unknown ctrl shortcut leaves state unchanged", () => {
  const state = createState("hello", 5);
  const result = applyResolvedInput(state, { input: "x", key: { ctrl: true } });

  assert.equal(result, state);
});

test("supports home, end, arrow, and word movement", () => {
  const endState = applyEvents([{ type: "insertText", text: "hello world" }]);

  assert.equal(
    applyEvent(endState, resolveEditEvent("", { leftArrow: true })).editor
      .cursor,
    10,
  );
  assert.equal(
    applyEvent(endState, resolveEditEvent("", { leftArrow: true, ctrl: true }))
      .editor.cursor,
    6,
  );
  assert.equal(
    applyEvent(
      createState("hello world", 0),
      resolveEditEvent("", { rightArrow: true, ctrl: true }),
    ).editor.cursor,
    6,
  );
  assert.equal(
    applyEvent(createState("hello", 2), resolveEditEvent("", { home: true }))
      .editor.cursor,
    0,
  );
  assert.equal(
    applyEvent(createState("hello", 2), resolveEditEvent("", { end: true }))
      .editor.cursor,
    5,
  );
});

test("moves vertically through wrapped lines", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const state = applyEvents(
    [{ type: "insertText", text: "abcd ef" }],
    createContext(layout),
  );

  assert.equal(
    applyEvent(
      state,
      resolveEditEvent("", { upArrow: true }),
      createContext(layout),
    ).editor.cursor,
    3,
  );
  assert.equal(
    applyEvent(
      createState("abcd ef", 3),
      resolveEditEvent("", { downArrow: true }),
      createContext(layout),
    ).editor.cursor,
    7,
  );
});

test("resolves plain vertical arrows as line-or-history intents", () => {
  assert.deepEqual(resolveEditEvent("", { upArrow: true }), {
    type: "upLineOrHistory",
  });
  assert.deepEqual(resolveEditEvent("", { downArrow: true }), {
    type: "downLineOrHistory",
  });
});

test("resolves modified vertical arrows as plain cursor movement", () => {
  assert.deepEqual(
    resolveInputBoxCommand("", { upArrow: true, ctrl: true }),
    { type: "edit", event: { type: "moveCursor", movement: "up" } },
  );
  assert.deepEqual(
    resolveInputBoxCommand("", { downArrow: true, shift: true }),
    { type: "edit", event: { type: "moveCursor", movement: "down" } },
  );
});

test("keeps visual arrow movement before entering history", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const history = ["previous prompt"];
  const context = createContext(layout, history);
  const wrappedState = createState("abcd ef", 7);

  const movedUp = applyResolvedInput(
    wrappedState,
    { key: { upArrow: true } },
    context,
  );
  assert.equal(movedUp.editor.cursor, 3);
  assert.equal(movedUp.historyBrowsing, null);

  const movedDown = applyResolvedInput(
    createState("abcd ef", 3),
    { key: { downArrow: true } },
    context,
  );
  assert.equal(movedDown.editor.cursor, 7);
  assert.equal(movedDown.historyBrowsing, null);
});

test("enters history from the first visual line", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const history = ["old prompt", "latest prompt"];
  const context = createContext(layout, history);
  const state = createState("draft text", 2);

  const result = applyResolvedInput(
    state,
    { key: { upArrow: true } },
    context,
  );

  assert.deepEqual(result.editor, {
    text: "latest prompt",
    cursor: "latest prompt".length,
  });
  assert.deepEqual(result.historyBrowsing, { index: 1, draft: "draft text" });
});

test("single-line up arrow enters history directly", () => {
  const history = ["old prompt", "latest prompt"];
  const context = createContext(defaultLayout, history);

  const result = applyResolvedInput(
    createState("draft"),
    { key: { upArrow: true } },
    context,
  );

  assert.deepEqual(result.editor, {
    text: "latest prompt",
    cursor: "latest prompt".length,
  });
  assert.deepEqual(result.historyBrowsing, { index: 1, draft: "draft" });
});

test("browses history directly once history mode is active", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const history = ["oldest", "middle wrapped prompt", "latest"];
  const context = createContext(layout, history);
  const state = createHistoryState({
    text: "latest",
    index: 2,
    draft: "draft",
    cursor: 3,
  });

  const previous = applyResolvedInput(
    state,
    { key: { upArrow: true } },
    context,
  );
  assert.deepEqual(previous.editor, {
    text: "middle wrapped prompt",
    cursor: "middle wrapped prompt".length,
  });
  assert.deepEqual(previous.historyBrowsing, { index: 1, draft: "draft" });

  const next = applyResolvedInput(
    previous,
    { key: { downArrow: true } },
    context,
  );
  assert.deepEqual(next.editor, { text: "latest", cursor: "latest".length });
  assert.deepEqual(next.historyBrowsing, { index: 2, draft: "draft" });
});

test("restores draft after moving past the latest history entry", () => {
  const history = ["old prompt", "latest prompt"];
  const context = createContext(defaultLayout, history);
  const enteredHistory = applyResolvedInput(
    createState("draft text"),
    { key: { upArrow: true } },
    context,
  );

  const restored = applyResolvedInput(
    enteredHistory,
    { key: { downArrow: true } },
    context,
  );

  assert.deepEqual(restored.editor, {
    text: "draft text",
    cursor: "draft text".length,
  });
  assert.equal(restored.historyBrowsing, null);
});

test("selects the current history entry as submittable text", () => {
  const state = createHistoryState({
    text: "previous command",
    index: 0,
    draft: "draft",
  });

  assert.equal(getSubmittableText(state), "previous command");
});

test("ignores history navigation at history boundaries", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const history = ["oldest", "latest"];
  const context = createContext(layout, history);
  const oldest = createHistoryState({
    text: "oldest",
    index: 0,
    draft: "draft",
  });

  assert.equal(
    applyResolvedInput(oldest, { key: { upArrow: true } }, context),
    oldest,
  );

  const ordinaryLastLine = createState("abcd ef", 7);
  assert.equal(
    applyResolvedInput(
      ordinaryLastLine,
      { key: { downArrow: true } },
      context,
    ),
    ordinaryLastLine,
  );
});

test("cursor movement in history keeps the original draft recoverable", () => {
  const history = ["previous command"];
  const context = createContext(defaultLayout, history);
  const state = createHistoryState({
    text: "previous command",
    index: 0,
    draft: "draft",
    cursor: 8,
  });

  const moved = applyResolvedInput(
    state,
    { key: { rightArrow: true } },
    context,
  );

  assert.deepEqual(moved.editor, { text: "previous command", cursor: 9 });
  assert.deepEqual(moved.historyBrowsing, { index: 0, draft: "draft" });

  const restored = applyResolvedInput(
    moved,
    { key: { downArrow: true } },
    context,
  );

  assert.deepEqual(restored.editor, { text: "draft", cursor: "draft".length });
  assert.equal(restored.historyBrowsing, null);
});

test("no-op deletion in history keeps the original draft recoverable", () => {
  const history = ["previous command"];
  const context = createContext(defaultLayout, history);
  const atStart = createHistoryState({
    text: "previous command",
    index: 0,
    draft: "draft",
    cursor: 0,
  });
  const afterBackspace = applyResolvedInput(
    atStart,
    { key: { backspace: true } },
    context,
  );
  assert.equal(afterBackspace, atStart);

  const atEnd = createHistoryState({
    text: "previous command",
    index: 0,
    draft: "draft",
  });
  const afterDelete = applyResolvedInput(
    atEnd,
    { key: { delete: true } },
    context,
  );
  assert.equal(afterDelete, atEnd);

  const restored = applyResolvedInput(
    afterBackspace,
    { key: { downArrow: true } },
    context,
  );
  assert.deepEqual(restored.editor, { text: "draft", cursor: 5 });
  assert.equal(restored.historyBrowsing, null);
});

test("editing a history entry exits history browsing", () => {
  const history = ["older command", "previous command"];
  const context = createContext(defaultLayout, history);
  const state = createHistoryState({
    text: "previous command",
    index: 1,
    draft: "original draft",
  });

  const edited = applyResolvedInput(state, { input: "!" }, context);
  assert.deepEqual(edited.editor, {
    text: "previous command!",
    cursor: "previous command!".length,
  });
  assert.equal(edited.historyBrowsing, null);
  assert.equal(
    applyResolvedInput(edited, { key: { downArrow: true } }, context),
    edited,
  );

  const enteredHistory = applyResolvedInput(
    edited,
    { key: { upArrow: true } },
    context,
  );
  const restored = applyResolvedInput(
    enteredHistory,
    { key: { downArrow: true } },
    context,
  );

  assert.deepEqual(enteredHistory.historyBrowsing, {
    index: 1,
    draft: "previous command!",
  });
  assert.deepEqual(restored.editor, {
    text: "previous command!",
    cursor: "previous command!".length,
  });
  assert.equal(restored.historyBrowsing, null);
});

test("renders wrapped text, with the cursor as a reversed char when shown", () => {
  const layout: InputBoxLayout = { inputColumns: 4 };
  const state = applyEvents(
    [{ type: "insertText", text: "abcd ef" }],
    createContext(layout),
  );

  // 不显示光标时：纯文本（已换行）
  assert.equal(selectInputBoxView(state, layout).renderedText, "abcd\n ef");

  // 显示光标时：光标落在行尾，追加一个蓝色反色字符代表光标
  assert.equal(
    selectInputBoxView(state, layout, true).renderedText,
    "abcd\n ef\u001B[38;2;85;168;232m\u001B[7m \u001B[27m\u001B[39m",
  );
});

test("stripMouseInput removes SGR mouse events with and without escape prefix", () => {
  assert.equal(stripMouseInput("\u001b[<64;18;22M"), "");
  assert.equal(stripMouseInput("\u001b[<64;18;22;1M"), "");
  assert.equal(stripMouseInput("<0;18;22M<0;18;22m"), "");
  assert.equal(stripMouseInput("hello<65;22;8M"), "hello");
});
