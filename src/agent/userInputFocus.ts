import type { ChatMessage } from "../llm/types.js";

export const USER_INPUT_FOCUS_MESSAGE_NAME = "user_input_focus";

const MAX_FOCUS_ITEMS = 20;
const MAX_ITEM_LENGTH = 360;

export function buildUserInputFocusMessage(userMessage: string): ChatMessage | null {
  const items = extractFocusItems(userMessage);
  if (items.length === 0) return null;

  return {
    role: "system",
    name: USER_INPUT_FOCUS_MESSAGE_NAME,
    content: renderFocusMessage(items),
  };
}

export function isUserInputFocusMessage(message: ChatMessage): boolean {
  return message.role === "system" && message.name === USER_INPUT_FOCUS_MESSAGE_NAME;
}

function extractFocusItems(userMessage: string): string[] {
  return userMessage
    .split(/\r?\n/)
    .flatMap(splitLineIntoItems)
    .map(cleanFocusItem)
    .filter((item) => item.length > 0)
    .slice(0, MAX_FOCUS_ITEMS);
}

function splitLineIntoItems(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (isListLikeLine(trimmed)) return [trimmed];
  return splitLongSentence(trimmed);
}

function splitLongSentence(line: string): string[] {
  if (line.length <= MAX_ITEM_LENGTH) return [line];
  return line.split(/(?<=[。！？!?；;])\s*/).filter(Boolean);
}

function cleanFocusItem(item: string): string {
  return truncateText(
    item.replace(/^\s*(?:[-*+]|\d+[.)]|[一二三四五六七八九十]+[、.])\s*/, "").trim(),
    MAX_ITEM_LENGTH,
  );
}

function isListLikeLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)]|[一二三四五六七八九十]+[、.])\s+/.test(line);
}

function renderFocusMessage(items: string[]): string {
  return [
    "<user_input_focus>",
    "内部关注笔记：回复时以用户原文为准，不要向用户复述本笔记。",
    "本轮用户输入需要逐项纳入执行和最终回复：",
    ...items.map((item, index) => `${index + 1}. ${item}`),
    "执行前自检：是否遗漏了中间段落、列表项、约束、路径、命令、数字或否定条件？",
    "</user_input_focus>",
  ].join("\n");
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}
