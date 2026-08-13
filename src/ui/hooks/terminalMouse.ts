import type { TranscriptScrollAction } from "../components/TranscriptViewport/transcriptScroll.js";
import type { TranscriptSelectEvent } from "../components/TranscriptViewport/transcriptSelection.js";

// 1000/1002 的拖拽上报语义在终端实现间不一致（有的 1000 不报按住移动），同时开启并以 1002 兜底
export const ENABLE_SGR_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
export const DISABLE_SGR_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1006l";

const SGR_MOUSE_PATTERN = /(?:\x1b\[|\[)?<(\d+)(?:;\d+){2,}[mM]/g;
const LEGACY_MOUSE_PATTERN = /\x1b\[M.{3}/gs;
const SGR_MOUSE_EVENT_PATTERN = /(?:\x1b\[|\[)?<(\d+);(\d+);(\d+)([mM])/g;
const SGR_SHIFT_WHEEL_UP = "68";
const SGR_SHIFT_WHEEL_DOWN = "69";
// 左键按下/拖拽/松开 → 选中开始/扩展/结束；带 Shift 的拖拽由终端原生选中接管，不会上报到这里
const SGR_SELECT_ACTIONS: Record<string, TranscriptSelectEvent["action"]> = {
  "0": "start",
  "32": "extend",
  "3": "end",
};

export type MouseBatchAction =
  | { kind: "scroll"; action: TranscriptScrollAction }
  | { kind: "select"; event: TranscriptSelectEvent }
  | { kind: "ignore" };

/** 按事件出现顺序解析一批输入中的全部 SGR 鼠标事件，逐事件归类，不丢失混合事件 */
export const getMouseBatchActions = (input: string, wheelRows: number): MouseBatchAction[] => {
  const actions: MouseBatchAction[] = [];
  for (const match of input.matchAll(SGR_MOUSE_EVENT_PATTERN)) {
    const event = { code: match[1], terminator: match[4], col: Number(match[2]), row: Number(match[3]) };
    actions.push(getMouseBatchAction(event, wheelRows));
  }
  return actions;
};

// Shift+滚轮 → 滚动；左键事件 → 选中；其余鼠标事件消费掉不进入输入
const getMouseBatchAction = (
  event: { code: string; terminator: string; col: number; row: number },
  wheelRows: number,
): MouseBatchAction => {
  if (event.code === SGR_SHIFT_WHEEL_UP) {
    return { kind: "scroll", action: { type: "lineUp", amount: wheelRows } };
  }
  if (event.code === SGR_SHIFT_WHEEL_DOWN) {
    return { kind: "scroll", action: { type: "lineDown", amount: wheelRows } };
  }
  const selectAction = getSelectAction(event.code, event.terminator);
  if (selectAction) {
    return { kind: "select", event: { action: selectAction, col: event.col, row: event.row } };
  }
  return { kind: "ignore" };
};

// SGR 松开事件以 m 结尾（部分终端也会用 3 号事件码），统一视为选中结束
const getSelectAction = (
  code: string,
  terminator: string,
): TranscriptSelectEvent["action"] | null =>
  terminator === "m" ? "end" : (SGR_SELECT_ACTIONS[code] ?? null);

export const hasMouseInput = (input: string): boolean =>
  input.search(SGR_MOUSE_PATTERN) !== -1 || input.search(LEGACY_MOUSE_PATTERN) !== -1;

export const stripMouseInput = (input: string): string =>
  input
    .replace(SGR_MOUSE_PATTERN, "")
    .replace(LEGACY_MOUSE_PATTERN, "");
