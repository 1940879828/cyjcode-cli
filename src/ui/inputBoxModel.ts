import { TextCursor } from "./textEditor.js";
import type { EditorPosition } from "./textEditor.js";

export interface InputBoxEditorState {
  text: string;
  cursor: number;
}

export interface InputBoxState {
  editor: InputBoxEditorState;
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
  | { type: "submit" }
  | { type: "moveCursor"; movement: CursorMovement }
  | { type: "deleteText"; deletion: TextDeletion }
  | { type: "reset" }
  | { type: "ignore" };

export type InputBoxEffect = {
  type: "submit";
  text: string;
};

export interface InputBoxReduction {
  state: InputBoxState;
  effects: InputBoxEffect[];
}

export interface InputBoxView {
  renderedText: string;
  cursorPosition: EditorPosition;
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

const META_SHORTCUTS: Record<string, InputBoxEvent> = {
  b: moveCursor("previousWord"),
  d: deleteText("wordAfter"),
  f: moveCursor("nextWord"),
};

export function createInputBoxState(): InputBoxState {
  return { editor: { text: "", cursor: 0 } };
}

export function resolveInputBoxEvent(
  input: string,
  key: InputKeyLike,
): InputBoxEvent {
  if (key.return) return key.shift || key.meta ? insertText("\n") : { type: "submit" };
  if (key.backspace) {
    return deleteText(key.ctrl || key.meta ? "wordBefore" : "backward");
  }
  if (key.delete) return deleteText(key.meta ? "toLineEnd" : "forward");

  if (key.home) return moveCursor("startOfLine");
  if (key.end) return moveCursor("endOfLine");
  if (key.upArrow) return moveCursor("up");
  if (key.downArrow) return moveCursor("down");
  if (key.leftArrow) return moveCursor(key.ctrl || key.meta ? "previousWord" : "left");
  if (key.rightArrow) return moveCursor(key.ctrl || key.meta ? "nextWord" : "right");

  if (key.ctrl) return CTRL_SHORTCUTS[input.toLowerCase()] ?? ignore();
  if (key.meta) return META_SHORTCUTS[input.toLowerCase()] ?? ignore();
  if (input.length > 0) return insertText(input);

  return ignore();
}

export function reduceInputBoxState(
  state: InputBoxState,
  event: InputBoxEvent,
  layout: InputBoxLayout,
): InputBoxReduction {
  switch (event.type) {
    case "insertText":
      return event.text.length === 0
        ? unchanged(state)
        : updateCursor(state, layout, (cursor) => cursor.insert(event.text));
    case "moveCursor":
      return updateCursor(state, layout, (cursor) =>
        moveCursorBy(cursor, event.movement),
      );
    case "deleteText":
      return updateCursor(state, layout, (cursor) =>
        deleteFromCursor(cursor, event.deletion),
      );
    case "submit":
      return submitState(state);
    case "reset":
      return { state: createInputBoxState(), effects: [] };
    case "ignore":
      return unchanged(state);
  }
}

export function selectInputBoxView(
  state: InputBoxState,
  layout: InputBoxLayout,
): InputBoxView {
  const cursor = createCursor(state, layout);
  return {
    renderedText: cursor.getRenderedText(),
    cursorPosition: cursor.getPosition(),
  };
}

const createCursor = (state: InputBoxState, layout: InputBoxLayout): TextCursor =>
  TextCursor.fromText(state.editor.text, layout.inputColumns, state.editor.cursor);

const unchanged = (state: InputBoxState): InputBoxReduction => ({
  state,
  effects: [],
});

const updateCursor = (
  state: InputBoxState,
  layout: InputBoxLayout,
  update: (cursor: TextCursor) => TextCursor,
): InputBoxReduction => withEditor(state, update(createCursor(state, layout)));

const withEditor = (
  state: InputBoxState,
  cursor: TextCursor,
): InputBoxReduction => ({
  state: {
    ...state,
    editor: {
      text: cursor.text,
      cursor: cursor.offset,
    },
  },
  effects: [],
});

const submitState = (state: InputBoxState): InputBoxReduction => {
  const text = state.editor.text.trim();
  if (!text) return unchanged(state);

  return {
    state: createInputBoxState(),
    effects: [{ type: "submit", text }],
  };
};

const moveCursorBy = (
  cursor: TextCursor,
  movement: CursorMovement,
): TextCursor => {
  switch (movement) {
    case "left":
      return cursor.left();
    case "right":
      return cursor.right();
    case "up":
      return cursor.up();
    case "down":
      return cursor.down();
    case "startOfLine":
      return cursor.startOfLine();
    case "endOfLine":
      return cursor.endOfLine();
    case "previousWord":
      return cursor.prevWord();
    case "nextWord":
      return cursor.nextWord();
  }
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
