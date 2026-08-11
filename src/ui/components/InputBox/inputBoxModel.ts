import { TextCursor } from "./textEditor.js";

// 编辑器本身的核心状态
export interface InputBoxEditorState {
  // 文本内容
  text: string;
  // 光标位置
  cursor: number;
}

// 输入框状态由文本编辑器与可选的历史浏览会话组成
export interface InputBoxState {
  editor: InputBoxEditorState;
  // draft 是进入历史浏览前的普通输入快照；真正编辑历史条目会退出历史浏览。
  historyBrowsing: { index: number; draft: string } | null;
}

// 纯布局参数集合
export interface InputBoxLayout {
  // 输入框在当前终端环境下有多少可用宽度
  inputColumns: number;
}

/**
 * 按键状态描述符
 * 这次按键是否携带某个修饰键 / 是否是某个功能键
 */
export interface InputKeyLike {
  // 回车键 
  return?: boolean;
  // shift键
  shift?: boolean;
  // Meta 修饰键 Option / Alt
  meta?: boolean;
  // 退格键
  backspace?: boolean;
  // Ctrl 修饰键
  ctrl?: boolean;
  // 删除键
  delete?: boolean;
  // Home键
  home?: boolean;
  // End键
  end?: boolean;
  // ⬆️
  upArrow?: boolean;
  // ⬇️
  downArrow?: boolean;
  // ⬅️
  leftArrow?: boolean;
  // ➡️
  rightArrow?: boolean;
}

// 光标所有可能的移动方式
export type CursorMovement =
  | "left"
  | "right"
  | "up"
  | "down"
  | "startOfLine"
  | "endOfLine"
  | "previousWord"
  | "nextWord";


// 文本所有可能的删除方式
export type TextDeletion =
  // 一个字符（退格）
  | "backward"
  // 一个字符（Delete）
  | "forward"
  // 前一个词
  | "wordBefore"
  // 后一个词
  | "wordAfter"
  // 删到行首
  | "toLineStart"
  // 删到行尾
  | "toLineEnd";

// 所有能改变输入框状态的用户动作
export type InputBoxEvent =
  // 插入/粘贴
  | { type: "insertText"; text: string }
  // 移动光标
  | { type: "moveCursor"; movement: CursorMovement }
  // 删除文本
  | { type: "deleteText"; deletion: TextDeletion }
  | { type: "upLineOrHistory" }
  | { type: "downLineOrHistory" }
  // 重置
  | { type: "reset" }
  // 忽略
  | { type: "ignore" };

// 输入框命令：编辑命令只改变本地状态，提交命令由 UI 层触发外部回调
export type InputBoxCommand =
  | { type: "edit"; event: InputBoxEvent }
  | { type: "submit" };

// 输入框的渲染视图
export interface InputBoxView {
  // 要显示在屏幕上的文本（已按终端宽度换行处理，光标以反色字符内嵌）
  renderedText: string;
}

export interface InputBoxModelContext {
  layout: InputBoxLayout;
  inputHistory: readonly string[];
}

// 创建一个 "ignore" 类型的 InputBoxEvent
const ignore = (): InputBoxEvent => ({ type: "ignore" });

// 创建一个 "insertText" 类型的 InputBoxEvent
const insertText = (text: string): InputBoxEvent => ({
  type: "insertText",
  text,
});

// 创建一个 "moveCursor" 类型的 InputBoxEvent
const moveCursor = (movement: CursorMovement): InputBoxEvent => ({
  type: "moveCursor",
  movement,
});

// 创建一个 "deleteText" 类型的 InputBoxEvent
const deleteText = (deletion: TextDeletion): InputBoxEvent => ({
  type: "deleteText",
  deletion,
});

const upLineOrHistory = (): InputBoxEvent => ({ type: "upLineOrHistory" });

const downLineOrHistory = (): InputBoxEvent => ({ type: "downLineOrHistory" });

// 创建一个 "edit" 类型的 InputBoxCommand
const editCommand = (event: InputBoxEvent): InputBoxCommand => ({
  type: "edit",
  event,
});

// 按住 Ctrl 再按某个字母
const CTRL_SHORTCUTS: Record<string, InputBoxEvent> = {
  a: moveCursor("startOfLine"),   // Ctrl+A 行首
  b: moveCursor("left"),          // Ctrl+B 左移
  d: deleteText("forward"),       // Ctrl+D 删右
  e: moveCursor("endOfLine"),     // Ctrl+E 行尾
  f: moveCursor("right"),         // Ctrl+F 右移
  h: deleteText("backward"),      // Ctrl+H 退格
  k: deleteText("toLineEnd"),     // Ctrl+K 删到行尾
  u: deleteText("toLineStart"),   // Ctrl+U 删到行首
  w: deleteText("wordBefore"),    // Ctrl+W 删前一个词
};

// 按住 Meta（macOS 的 Option⌥，Linux/Windows 上通常对应 Alt）再按字母
const META_SHORTCUTS: Record<string, InputBoxEvent> = {
  b: moveCursor("previousWord"),  // Meta+B 上一个词
  d: deleteText("wordAfter"),     // Meta+D 删后一个词
  f: moveCursor("nextWord"),      // Meta+F 下一个词
};

// 输入框的初始状态工厂函数
export function createInputBoxState(): InputBoxState {
  return {
    editor: { text: "", cursor: 0 },
    historyBrowsing: null,
  };
}

/**
 * 按键翻译
 * - 这个按键对输入框意味着什么操作
 * @param input 实际输入的字符内容
 * @param key 	按键状态描述（哪个键 + 哪些修饰键）
 * @returns 改变输入框状态的用户动作
 */
export function resolveInputBoxCommand(
  input: string,
  key: InputKeyLike,
): InputBoxCommand {
  // 按了回车：如果带了 Shift 或 Meta → 插入换行符（多行输入），否则 → 提交。
  if (key.return) {
    return key.shift || key.meta ? editCommand(insertText("\n")) : { type: "submit" };
  }
  // 带 Ctrl/Meta → 删前一个词；否则 → 删一个字符（退格）。
  if (key.backspace) {
    return editCommand(deleteText(key.ctrl || key.meta ? "wordBefore" : "backward"));
  }
  // 带 Meta → 删到行尾；否则 → 删右一个字符。
  if (key.delete) return editCommand(deleteText(key.meta ? "toLineEnd" : "forward"));

  /**
   * Home→行首、End→行尾、↑/↓→上/下移
   * ←/→：带 Ctrl/Meta → 按词移动，否则 → 单字符移动
   */
  if (key.home) return editCommand(moveCursor("startOfLine"));
  if (key.end) return editCommand(moveCursor("endOfLine"));
  if (key.upArrow) return editCommand(resolveUpArrowEvent(key));
  if (key.downArrow) return editCommand(resolveDownArrowEvent(key));
  if (key.leftArrow) {
    return editCommand(moveCursor(key.ctrl || key.meta ? "previousWord" : "left"));
  }
  if (key.rightArrow) {
    return editCommand(moveCursor(key.ctrl || key.meta ? "nextWord" : "right"));
  }

  // 按了 Ctrl → 查 CTRL_SHORTCUTS 表，命中返回事件，未命中 ignore()
  if (key.ctrl) return editCommand(CTRL_SHORTCUTS[input.toLowerCase()] ?? ignore());
  // 按了 Meta → 查 META_SHORTCUTS 表，同上
  if (key.meta) return editCommand(META_SHORTCUTS[input.toLowerCase()] ?? ignore());
  // 如果确实输入了可见字符 → 作为文本插入
  if (input.length > 0) return editCommand(insertText(input));

  // 忽略比如按了 F1、方向键之外但没带修饰的键、无法识别的输入
  return editCommand(ignore());
}

/**
 * 给定当前状态、一个事件、以及布局，产出一个全新的状态。
 * - 把"用户动作"变成"状态变更"
 * @param state 当前状态
 * @param event 要处理的事件（用户动作）
 * @param context 布局和历史列表等纯函数外部上下文
 * @returns 
 */
export function reduceInputBoxState(
  state: InputBoxState,
  event: InputBoxEvent,
  context: InputBoxModelContext,
): InputBoxState {
  const { layout } = context;
  switch (event.type) {
    // 插入/粘贴文本
    case "insertText":
      return event.text.length === 0
        // 文本为空 → 状态不变（unchanged）
        ? unchanged(state)
        // 否则 → 构造光标，执行 insert，生成新状态
        : updateText(state, layout, (cursor) => cursor.insert(event.text));
    // 移动光标
    case "moveCursor":
      // moveCursorBy 把 CursorMovement 分发到 TextCursor 的移动方法
      return updateCursor(state, layout, (cursor) =>
        moveCursorBy(cursor, event.movement),
      );
    // 删除文本
    case "deleteText":
      return updateText(state, layout, (cursor) =>
        // deleteFromCursor 把 TextDeletion 分发到 TextCursor 的删除方法
        deleteFromCursor(cursor, event.deletion),
      );
    // 历史浏览
    case "upLineOrHistory":
      return upLineOrHistoryState(state, context);
    case "downLineOrHistory":
      return downLineOrHistoryState(state, context);
    // 重置
    case "reset":
      // 直接回到初始状态
      return createInputBoxState();
    //  忽略 什么都不做，返回原状态
    case "ignore":
      return unchanged(state);
  }
}

/**
 * 视图选择器
 * 基于现在的状态，渲染出来的文本是什么、光标要放在哪里？
 * @param state 
 * @param layout 
 * @returns 
 */
// 光标色块的前景色：24 位真彩色，与 Header 里 " Code" 的 TIMER_BLUE (#55A8E8) 一致。
// \x1b[38;2;R;G;Bm 设置 RGB 前景色，配合反色显示为同色背景块。
const CURSOR_FG_BLUE = "\u001B[38;2;85;168;232m";

export function selectInputBoxView(
  state: InputBoxState,
  layout: InputBoxLayout,
  showCursor = false,
): InputBoxView {
  // 获取TextCursor实例
  const cursor = createCursor(state, layout);
  return {
    // 渲染出来的文本是什么；showCursor 时把光标以蓝色反色字符内嵌进文本
    renderedText: showCursor
      ? cursor.renderWithCursor(" ", CURSOR_FG_BLUE)
      : cursor.getRenderedText(),
  };
}

// 构建TextCursor实例
const createCursor = (state: InputBoxState, layout: InputBoxLayout): TextCursor =>
  TextCursor.fromText(state.editor.text, layout.inputColumns, state.editor.cursor);

// 这次事件处理前后状态没有任何变化
const unchanged = (state: InputBoxState): InputBoxState => state;

// 判断方向键是否 不带任何修饰键 被按下
const isPlainArrowKey = (key: InputKeyLike): boolean =>
  !key.shift && !key.ctrl && !key.meta;

const resolveUpArrowEvent = (key: InputKeyLike): InputBoxEvent =>
  isPlainArrowKey(key) ? upLineOrHistory() : moveCursor("up");

const resolveDownArrowEvent = (key: InputKeyLike): InputBoxEvent =>
  isPlainArrowKey(key) ? downLineOrHistory() : moveCursor("down");

// 光标是否在第一行
const isAtFirstVisualLine = (
  state: InputBoxState,
  layout: InputBoxLayout,
): boolean => {
  return createCursor(state, layout).getPosition().line === 0;
};

// 光标是否在最后一行
const isAtLastVisualLine = (
  state: InputBoxState,
  layout: InputBoxLayout,
): boolean => {
  const cursor = createCursor(state, layout);
  return cursor.getPosition().line === cursor.getLineCount() - 1;
};

const upLineOrHistoryState = (
  state: InputBoxState,
  context: InputBoxModelContext,
): InputBoxState => {
  // historyBrowsing 不为 null 正在浏览历史
  if (state.historyBrowsing !== null) {
    // 触发浏览上一条历史
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
  // 进入历史前的快照
  const draft = state.historyBrowsing?.draft ?? state.editor.text;
  // 计算 下一个要浏览的历史条目索引 首次进入就拿最后一个 后续在浏览历史状态就 上一次的index-1
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
  // 取出对应历史文本
  const text = inputHistory[browsing.index] ?? "";
  return {
    ...state,
    // 替换编辑器内容
    editor: { text, cursor: text.length },
    // 更新浏览状态
    historyBrowsing: browsing,
  };
};

// 退出浏览历史状态
const restoreDraftBeforeHistory = (state: InputBoxState): InputBoxState => {
  const text = state.historyBrowsing?.draft ?? state.editor.text;
  return {
    ...state,
    editor: { text, cursor: text.length },
    historyBrowsing: null,
  };
};

/**
 * 通用光标操作封装
 * 构造光标 → 应用操作 → 写回状态
 * 对光标执行任意一种操作（插入/移动/删除），然后产出新的 InputBoxState
 * @param state 
 * @param layout 
 * @param update 
 * @returns 
 */
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
    // 文本没变（如光标在首位按 backspace 这种 no-op 删除）
    return cursor.offset === state.editor.cursor
        // 光标也没动 → 完全不变，保留 historyBrowsing
      ? unchanged(state)
        // 仅光标动 → 更新 editor，但仍保留 historyBrowsing
      : withEditor(state, cursor);
  }
  return {
    // 文本被实际编辑后，当前内容成为普通草稿，不再绑定原历史条目。
    ...withEditor(state, cursor),
    historyBrowsing: null,
  };
};

// 负责"把结果写回状态"
const withEditor = (
  state: InputBoxState,
  cursor: TextCursor,
): InputBoxState => ({
  // 从 TextCursor 里取出 text 和 offset，生成新状态。
  ...state,
  editor: {
    text: cursor.text,
    cursor: cursor.offset,
  },
});

export const getSubmittableText = (state: InputBoxState): string | null => {
  const text = state.editor.text;
  // 用户没输入内容 忽略
  return isBlankInput(text) ? null : text;
};

export const isBlankInput = (text: string): boolean => !text.trim();

// 封装一层，用来添加历史记录
export const appendInputHistory = (
  inputHistory: readonly string[],
  text: string,
): readonly string[] => {
  // 空内容或与上一项相同就原样返回
  if (isBlankInput(text)) return inputHistory;
  if (inputHistory.at(-1) === text) return inputHistory;
  return [...inputHistory, text];
};

/**
 * 把 CursorMovement（光标移动枚举）"翻译"成 TextCursor 的具体移动方法调用
 * @param cursor 当前光标
 * @param movement 要做的移动动作
 * @returns 
 */
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

// 把 TextDeletion（文本删除枚举）"翻译"成 TextCursor 的具体删除方法调用
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
