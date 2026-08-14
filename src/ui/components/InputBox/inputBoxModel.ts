import { TextCursor } from "./textEditor.js";

export interface InputBoxEditorState {
  text: string;
  cursor: number;
}

export interface InputBoxState {
  editor: InputBoxEditorState;
  // draft 是进入历史浏览前的普通输入快照；真正编辑历史条目会退出历史浏览。
  historyBrowsing: { index: number; draft: string } | null;
}

export interface InputBoxLayout {
  inputColumns: number;
}

export interface InputKeyLike {
  return?: boolean;
  shift?: boolean;
  meta?: boolean;
  backspace?: boolean;
  ctrl?: boolean;
  delete?: boolean;
  home?: boolean;
  end?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
}

export type CursorMovement =
  | "left"
  | "right"
  | "up"
  | "down"
  | "startOfLine"
  | "endOfLine"
  | "previousWord"
  | "nextWord";
export type TextDeletion =
  | "backward"
  | "forward"
  | "wordBefore"
  | "wordAfter"
  | "toLineStart"
  | "toLineEnd";

export type InputBoxEvent =
  | { type: "insertText"; text: string }
  | { type: "moveCursor"; movement: CursorMovement }
  | { type: "deleteText"; deletion: TextDeletion }
  | { type: "upLineOrHistory" }
  | { type: "downLineOrHistory" }
  | { type: "reset" }
  | { type: "ignore" };

// 输入框命令：编辑命令只改变本地状态，提交命令由 UI 层触发外部回调
export type InputBoxCommand =
  | { type: "edit"; event: InputBoxEvent }
  | { type: "submit" };

export interface InputBoxView {
  renderedText: string;
  isBlank: boolean;
  // UI 裁剪多行输入时需要保留光标所在的视觉行。
  cursorVisualLine: number;
}

export interface InputBoxModelContext {
  layout: InputBoxLayout;
  inputHistory: readonly string[];
}

const ignore = (): InputBoxEvent => ({ type: "ignore" });

const insertText = (text: string): InputBoxEvent => ({
  type: "insertText",
  text,
});

const moveCursor = (movement: CursorMovement): InputBoxEvent => ({
  type: "moveCursor",
  movement,
});

const deleteText = (deletion: TextDeletion): InputBoxEvent => ({
  type: "deleteText",
  deletion,
});

const upLineOrHistory = (): InputBoxEvent => ({ type: "upLineOrHistory" });

const downLineOrHistory = (): InputBoxEvent => ({ type: "downLineOrHistory" });

const editCommand = (event: InputBoxEvent): InputBoxCommand => ({
  type: "edit",
  event,
});

const CTRL_SHORTCUTS: Record<string, InputBoxEvent> = {
  a: moveCursor("startOfLine"),
  b: moveCursor("left"),
  d: deleteText("forward"),
  e: moveCursor("endOfLine"),
  f: moveCursor("right"),
  h: deleteText("backward"),
  k: deleteText("toLineEnd"),
  u: deleteText("toLineStart"),
  w: deleteText("wordBefore"),
};

// Meta 在 macOS 通常是 Option，在 Linux/Windows 终端里通常是 Alt。
const META_SHORTCUTS: Record<string, InputBoxEvent> = {
  b: moveCursor("previousWord"),
  d: deleteText("wordAfter"),
  f: moveCursor("nextWord"),
};

export function createInputBoxState(): InputBoxState {
  return {
    editor: { text: "", cursor: 0 },
    historyBrowsing: null,
  };
}

export function resolveInputBoxCommand(
  input: string,
  key: InputKeyLike,
): InputBoxCommand {
  if (key.return) return resolveReturnCommand(key);
  if (key.backspace) {
    return editCommand(deleteText(key.ctrl || key.meta ? "wordBefore" : "backward"));
  }
  if (key.delete) return editCommand(deleteText(key.meta ? "toLineEnd" : "forward"));

  const navigation = resolveNavigationCommand(key);
  if (navigation) return navigation;

  if (key.ctrl) return editCommand(CTRL_SHORTCUTS[input.toLowerCase()] ?? ignore());
  if (key.meta) return editCommand(META_SHORTCUTS[input.toLowerCase()] ?? ignore());
  if (input.length > 0) return editCommand(insertText(input));

  return editCommand(ignore());
}

function resolveReturnCommand(key: InputKeyLike): InputBoxCommand {
  return key.ctrl || key.shift || key.meta
    ? editCommand(insertText("\n"))
    : { type: "submit" };
}

function resolveNavigationCommand(key: InputKeyLike): InputBoxCommand | null {
  if (key.home) return editCommand(moveCursor("startOfLine"));
  if (key.end) return editCommand(moveCursor("endOfLine"));
  if (key.upArrow) return editCommand(resolveUpArrowEvent(key));
  if (key.downArrow) return editCommand(resolveDownArrowEvent(key));
  if (key.leftArrow) return editCommand(resolveHorizontalMove(key, "left", "previousWord"));
  if (key.rightArrow) return editCommand(resolveHorizontalMove(key, "right", "nextWord"));
  return null;
}

function resolveHorizontalMove(
  key: InputKeyLike,
  plain: CursorMovement,
  modified: CursorMovement,
): InputBoxEvent {
  return moveCursor(key.ctrl || key.meta ? modified : plain);
}

export function reduceInputBoxState(
  state: InputBoxState,
  event: InputBoxEvent,
  context: InputBoxModelContext,
): InputBoxState {
  const { layout } = context;
  if (event.type === "insertText") return reduceInsertText(state, layout, event.text);
  if (event.type === "moveCursor") return reduceMoveCursor(state, layout, event.movement);
  if (event.type === "deleteText") return reduceDeleteText(state, layout, event.deletion);
  if (event.type === "upLineOrHistory") return upLineOrHistoryState(state, context);
  if (event.type === "downLineOrHistory") return downLineOrHistoryState(state, context);
  if (event.type === "reset") return createInputBoxState();
  return unchanged(state);
}

function reduceInsertText(state: InputBoxState, layout: InputBoxLayout, text: string): InputBoxState {
  return text.length === 0 ? unchanged(state) : updateText(state, layout, (cursor) => cursor.insert(text));
}

function reduceMoveCursor(
  state: InputBoxState,
  layout: InputBoxLayout,
  movement: CursorMovement,
): InputBoxState {
  return updateCursor(state, layout, (cursor) => moveCursorBy(cursor, movement));
}

function reduceDeleteText(
  state: InputBoxState,
  layout: InputBoxLayout,
  deletion: TextDeletion,
): InputBoxState {
  return updateText(state, layout, (cursor) => deleteFromCursor(cursor, deletion));
}

// 光标色块的前景色：24 位真彩色，与 Header 里 " Code" 的 TIMER_BLUE (#55A8E8) 一致。
// \x1b[38;2;R;G;Bm 设置 RGB 前景色，配合反色显示为同色背景块。
const CURSOR_FG_BLUE = "\u001B[38;2;85;168;232m";

export function selectInputBoxView(
  state: InputBoxState,
  layout: InputBoxLayout,
  showCursor = false,
): InputBoxView {
  const cursor = createCursor(state, layout);
  return {
    renderedText: showCursor
      ? cursor.renderWithCursor(" ", CURSOR_FG_BLUE)
      : cursor.getRenderedText(),
    isBlank: isBlankInput(state.editor.text),
    cursorVisualLine: cursor.getPosition().visualLine,
  };
}

const createCursor = (state: InputBoxState, layout: InputBoxLayout): TextCursor =>
  TextCursor.fromText(state.editor.text, layout.inputColumns, state.editor.cursor);

const unchanged = (state: InputBoxState): InputBoxState => state;

const isPlainArrowKey = (key: InputKeyLike): boolean =>
  !key.shift && !key.ctrl && !key.meta;

const resolveUpArrowEvent = (key: InputKeyLike): InputBoxEvent =>
  isPlainArrowKey(key) ? upLineOrHistory() : moveCursor("up");

const resolveDownArrowEvent = (key: InputKeyLike): InputBoxEvent =>
  isPlainArrowKey(key) ? downLineOrHistory() : moveCursor("down");

const isAtFirstVisualLine = (
  state: InputBoxState,
  layout: InputBoxLayout,
): boolean => {
  return createCursor(state, layout).getPosition().visualLine === 0;
};

const isAtLastVisualLine = (
  state: InputBoxState,
  layout: InputBoxLayout,
): boolean => {
  const cursor = createCursor(state, layout);
  return cursor.getPosition().visualLine === cursor.getLineCount() - 1;
};

const upLineOrHistoryState = (
  state: InputBoxState,
  context: InputBoxModelContext,
): InputBoxState => {
  if (state.historyBrowsing !== null) {
    return browsePreviousHistory(state, context.inputHistory);
  }
  return isAtFirstVisualLine(state, context.layout)
    ? browsePreviousHistory(state, context.inputHistory)
    : updateCursor(state, context.layout, (cursor) => cursor.up());
};

const downLineOrHistoryState = (
  state: InputBoxState,
  context: InputBoxModelContext,
): InputBoxState => {
  if (state.historyBrowsing !== null) {
    return browseNextHistory(state, context.inputHistory);
  }
  return isAtLastVisualLine(state, context.layout)
    ? unchanged(state)
    : updateCursor(state, context.layout, (cursor) => cursor.down());
};

const browsePreviousHistory = (
  state: InputBoxState,
  inputHistory: readonly string[],
): InputBoxState => {
  if (inputHistory.length === 0) return unchanged(state);
  // 最老历史是硬边界：继续向上停在当前条目。
  if (state.historyBrowsing?.index === 0) return unchanged(state);
  const draft = state.historyBrowsing?.draft ?? state.editor.text;
  const nextIndex =
    state.historyBrowsing === null
      ? inputHistory.length - 1
      : state.historyBrowsing.index - 1;
  return browseToHistoryIndex(state, inputHistory, { index: nextIndex, draft });
};

const browseNextHistory = (
  state: InputBoxState,
  inputHistory: readonly string[],
): InputBoxState => {
  if (state.historyBrowsing === null) return unchanged(state);
  const nextIndex = state.historyBrowsing.index + 1;
  if (nextIndex >= inputHistory.length) {
    // 最新历史之后的虚拟条目是进入历史前的草稿；向下越界即恢复并退出。
    return restoreDraftBeforeHistory(state);
  }
  return browseToHistoryIndex(
    state,
    inputHistory,
    { index: nextIndex, draft: state.historyBrowsing.draft },
  );
};

const browseToHistoryIndex = (
  state: InputBoxState,
  inputHistory: readonly string[],
  browsing: { index: number; draft: string },
): InputBoxState => {
  const text = inputHistory[browsing.index] ?? "";
  return {
    ...state,
    editor: { text, cursor: text.length },
    historyBrowsing: browsing,
  };
};

const restoreDraftBeforeHistory = (state: InputBoxState): InputBoxState => {
  const text = state.historyBrowsing?.draft ?? state.editor.text;
  return {
    ...state,
    editor: { text, cursor: text.length },
    historyBrowsing: null,
  };
};

// 光标移动只是查看历史条目，保留 historyBrowsing 才能继续上下浏览并恢复原草稿。
const updateCursor = (
  state: InputBoxState,
  layout: InputBoxLayout,
  update: (cursor: TextCursor) => TextCursor,
): InputBoxState => withEditor(state, update(createCursor(state, layout)));

const updateText = (
  state: InputBoxState,
  layout: InputBoxLayout,
  update: (cursor: TextCursor) => TextCursor,
): InputBoxState => {
  const cursor = update(createCursor(state, layout));
  if (cursor.text === state.editor.text) {
    return cursor.offset === state.editor.cursor
      ? unchanged(state)
      : withEditor(state, cursor);
  }
  return {
    // 文本被实际编辑后，当前内容成为普通草稿，不再绑定原历史条目。
    ...withEditor(state, cursor),
    historyBrowsing: null,
  };
};

const withEditor = (
  state: InputBoxState,
  cursor: TextCursor,
): InputBoxState => ({
  ...state,
  editor: {
    text: cursor.text,
    cursor: cursor.offset,
  },
});

export const getSubmittableText = (state: InputBoxState): string | null => {
  const text = state.editor.text;
  return isBlankInput(text) ? null : text;
};

export const isBlankInput = (text: string): boolean => !text.trim();

export const appendInputHistory = (
  inputHistory: readonly string[],
  text: string,
): readonly string[] => {
  if (isBlankInput(text)) return inputHistory;
  if (inputHistory.at(-1) === text) return inputHistory;
  return [...inputHistory, text];
};

const moveCursorBy = (
  cursor: TextCursor,
  movement: CursorMovement,
): TextCursor => {
  return CURSOR_MOVEMENTS[movement](cursor);
};

const CURSOR_MOVEMENTS: Record<CursorMovement, (cursor: TextCursor) => TextCursor> = {
  left: (cursor) => cursor.left(),
  right: (cursor) => cursor.right(),
  up: (cursor) => cursor.up(),
  down: (cursor) => cursor.down(),
  startOfLine: (cursor) => cursor.startOfLine(),
  endOfLine: (cursor) => cursor.endOfLine(),
  previousWord: (cursor) => cursor.prevWord(),
  nextWord: (cursor) => cursor.nextWord(),
};

const deleteFromCursor = (
  cursor: TextCursor,
  deletion: TextDeletion,
): TextCursor => {
  switch (deletion) {
    case "backward":
      return cursor.backspace();
    case "forward":
      return cursor.deleteForward();
    case "wordBefore":
      return cursor.deleteWordBefore();
    case "wordAfter":
      return cursor.deleteWordAfter();
    case "toLineStart":
      return cursor.deleteToLineStart();
    case "toLineEnd":
      return cursor.deleteToLineEnd();
  }
};
