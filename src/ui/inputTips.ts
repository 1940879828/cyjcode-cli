import type { ChatEntry } from "./chatTypes.js";

export const SELECTION_TIP_MESSAGE = "按 Shift 拖选文字";
export const INPUT_TIP_MESSAGES = [
  "Enter 发送 · Ctrl+Enter 换行 · ↑ 历史",
  "Ctrl+A/E 跳到行首/行尾",
  "Ctrl+W 删除前一个词 · Ctrl+U 清空到行首",
  "Ctrl+K 删除到行尾 · Alt+B/F 按词移动",
] as const;

interface InputTipState {
  entries: readonly ChatEntry[];
  isStreaming: boolean;
  inputIsBlank: boolean;
}

export function selectInputTips(state: InputTipState): readonly string[] {
  if (state.isStreaming) return [];
  if (!state.inputIsBlank) return INPUT_TIP_MESSAGES;
  return hasAssistantContent(state.entries) ? [SELECTION_TIP_MESSAGE] : [];
}

const hasAssistantContent = (entries: readonly ChatEntry[]): boolean =>
  entries.some((entry) => entry.role === "assistant");
