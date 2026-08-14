import { contentFingerprint } from "../utils/contentFingerprint.js";
import type { ChatMessage, ToolCall } from "../llm/types.js";
import type { ObservationMask, ObservationSource, ObservationStore } from "./observationStore.js";
import { isUserInputFocusMessage } from "./userInputFocus.js";

const RECENT_MESSAGE_COUNT = 10;
const MESSAGE_COUNT_TRIGGER = 24;
const TOKEN_TRIGGER = 64 * 1024;
const LARGE_TOOL_RESULT_CHARS = 8 * 1024;
const TARGET_TOKEN_BUDGET = 96 * 1024;

interface ObserveHistoryInput {
  history: ChatMessage[];
  store: ObservationStore;
}

export interface ObservationStats {
  originalMessages: number;
  observedMessages: number;
  masks: number;
  estimatedOriginalTokens: number;
  estimatedObservedTokens: number;
}

export interface ObservedHistory {
  messages: ChatMessage[];
  compressed: boolean;
  stats: ObservationStats;
}

interface MessageUnit {
  messages: ChatMessage[];
  maskable: boolean;
}

interface ObservationPlan {
  units: MessageUnit[];
  recentStart: number;
  oldUnits: MessageUnit[];
  budgetMode: boolean;
}

interface ObservedUnits {
  messages: ChatMessage[];
  maskCount: number;
}

export function shouldCompressHistory(history: ChatMessage[]): boolean {
  const plan = createObservationPlan(history);
  return shouldCompress(history, plan.oldUnits, plan.budgetMode);
}

export function observeHistory(input: ObserveHistoryInput): ObservedHistory {
  const plan = createObservationPlan(input.history);
  if (!shouldCompress(input.history, plan.oldUnits, plan.budgetMode)) {
    return uncompressedHistory(input.history);
  }

  const observed = observeUnits(plan, input.store);
  return observedHistory(input.history, observed.messages, observed.maskCount);
}

function createObservationPlan(history: ChatMessage[]): ObservationPlan {
  const units = buildMessageUnits(history);
  const recentStart = findRecentUnitStart(units);
  return {
    units,
    recentStart,
    oldUnits: units.slice(0, recentStart),
    budgetMode: estimateMessagesTokens(history) > TARGET_TOKEN_BUDGET,
  };
}

function buildMessageUnits(messages: ChatMessage[]): MessageUnit[] {
  const units: MessageUnit[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      units.push({ messages: [message], maskable: isMaskableSingleMessage(message) });
      continue;
    }
    const group = readToolGroup(messages, index, message.tool_calls);
    units.push({ messages: group.messages, maskable: true });
    index = group.endIndex;
  }
  return units;
}

function isMaskableSingleMessage(message: ChatMessage): boolean {
  return message.role === "tool" || isUserInputFocusMessage(message);
}

function readToolGroup(
  messages: ChatMessage[],
  startIndex: number,
  toolCalls: ToolCall[],
): { messages: ChatMessage[]; endIndex: number } {
  const ids = new Set(toolCalls.map((toolCall) => toolCall.id));
  let endIndex = startIndex;
  while (isToolResultFor(messages[endIndex + 1], ids)) endIndex++;
  return { messages: messages.slice(startIndex, endIndex + 1), endIndex };
}

function isToolResultFor(
  message: ChatMessage | undefined,
  ids: Set<string>,
): boolean {
  return message?.role === "tool" && ids.has(message.tool_call_id ?? "");
}

function findRecentUnitStart(units: MessageUnit[]): number {
  let messageCount = 0;
  for (let index = units.length - 1; index >= 0; index--) {
    messageCount += units[index]!.messages.length;
    if (messageCount >= RECENT_MESSAGE_COUNT) return index;
  }
  return 0;
}

function shouldCompress(
  history: ChatMessage[],
  oldUnits: MessageUnit[],
  budgetMode: boolean,
): boolean {
  if (oldUnits.length === 0) return false;
  if (budgetMode) return true;
  if (history.length > MESSAGE_COUNT_TRIGGER) return oldUnits.some(canMaskUnit);
  if (estimateMessagesTokens(history) > TOKEN_TRIGGER) return oldUnits.some(canMaskUnit);
  return oldUnits.some(canMaskUnit);
}

function observeUnits(plan: ObservationPlan, store: ObservationStore): ObservedUnits {
  const messages = plan.units.flatMap((unit, index) =>
    index < plan.recentStart ? observeOldUnit(unit, store, plan.budgetMode) : unit.messages
  );
  return { messages, maskCount: messages.filter(isMaskMessage).length };
}

function observeOldUnit(
  unit: MessageUnit,
  store: ObservationStore,
  budgetMode: boolean,
): ChatMessage[] {
  if (!shouldMaskUnit(unit, budgetMode)) return unit.messages;
  const mask = createMask(unit);
  store.put(mask);
  return [{ role: getMaskRole(unit), content: formatMaskPrompt(mask) }];
}

function shouldMaskUnit(unit: MessageUnit, budgetMode: boolean): boolean {
  return budgetMode || canMaskUnit(unit);
}

function canMaskUnit(unit: MessageUnit): boolean {
  return unit.maskable || hasLargeText(unit);
}

function hasLargeText(unit: MessageUnit): boolean {
  return unit.messages.some((message) => contentText(message).length > LARGE_TOOL_RESULT_CHARS);
}

function isMaskMessage(message: ChatMessage): boolean {
  return typeof message.content === "string" && message.content.startsWith("[历史");
}

function createMask(unit: MessageUnit): ObservationMask {
  const toolName = getUnitToolName(unit);
  const originalText = formatOriginalText(unit.messages);
  return {
    id: createMaskId(toolName, originalText),
    toolName,
    summary: summarizeText(originalText),
    originalText,
    source: readObservationSource(unit),
    createdAt: Date.now(),
  };
}

function getUnitToolName(unit: MessageUnit): string {
  const assistant = unit.messages.find((message) => message.tool_calls?.length);
  return assistant?.tool_calls?.[0]?.function.name ?? `${unit.messages[0]?.role ?? "unknown"}_message`;
}

function getMaskRole(unit: MessageUnit): ChatMessage["role"] {
  const role = unit.messages[0]?.role;
  return role === "system" || role === "user" ? role : "assistant";
}

function formatOriginalText(messages: ChatMessage[]): string {
  return messages.map(formatMessageForRecall).join("\n\n");
}

function formatMessageForRecall(message: ChatMessage): string {
  const payload = message.tool_calls ? ` tool_calls=${JSON.stringify(message.tool_calls)}` : "";
  return `${message.role}${payload}\n${contentText(message)}`;
}

function createMaskId(toolName: string, originalText: string): string {
  const fingerprint = contentFingerprint(`${toolName}\n${originalText}`).slice(0, 10);
  return `mask_${fingerprint}`;
}

function readObservationSource(unit: MessageUnit): ObservationSource {
  const parsed = parseToolResult(unit.messages.find((message) => message.role === "tool"));
  const snippet = readSnippetMetadata(parsed);
  if (!isFileSource(snippet)) return { kind: "unknown" };
  return {
    kind: "file",
    filePath: snippet.filePath,
    contentFingerprint: snippet.contentFingerprint,
  };
}

function parseToolResult(message: ChatMessage | undefined): Record<string, unknown> | null {
  try {
    return JSON.parse(contentText(message)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readSnippetMetadata(parsed: Record<string, unknown> | null): unknown {
  const metadata = parsed?.metadata;
  return typeof metadata === "object" && metadata !== null
    ? (metadata as { snippet?: unknown }).snippet
    : undefined;
}

function isFileSource(value: unknown): value is { filePath: string; contentFingerprint: string } {
  if (typeof value !== "object" || value === null) return false;
  const source = value as { filePath?: unknown; contentFingerprint?: unknown };
  return typeof source.filePath === "string" && typeof source.contentFingerprint === "string";
}

function formatMaskPrompt(mask: ObservationMask): string {
  return [
    `[${getMaskPromptTitle(mask)} ${mask.id}] ${mask.toolName}。`,
    `摘要: ${mask.summary}`,
    `需要原文时先调用 recall_history({"maskId":"${mask.id}"});`,
    "fresh 可当当前事实，stale/unknown 时重新观测。",
  ].join(" ");
}

function getMaskPromptTitle(mask: ObservationMask): string {
  return mask.source.kind === "file" || !mask.toolName.endsWith("_message")
    ? "历史工具结果已遮罩"
    : "历史内容已遮罩";
}

function summarizeText(text: string): string {
  const normalized = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return truncateText(normalized.slice(0, 6).join(" | "), 480);
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function observedHistory(
  original: ChatMessage[],
  observed: ChatMessage[],
  maskCount: number,
): ObservedHistory {
  return {
    messages: observed,
    compressed: true,
    stats: buildStats(original, observed, maskCount),
  };
}

function uncompressedHistory(history: ChatMessage[]): ObservedHistory {
  return {
    messages: [...history],
    compressed: false,
    stats: buildStats(history, history, 0),
  };
}

function buildStats(
  original: ChatMessage[],
  observed: ChatMessage[],
  maskCount: number,
): ObservationStats {
  return {
    originalMessages: original.length,
    observedMessages: observed.length,
    masks: maskCount,
    estimatedOriginalTokens: estimateMessagesTokens(original),
    estimatedObservedTokens: estimateMessagesTokens(observed),
  };
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.map(estimateMessageChars).reduce((sum, count) => sum + count, 0) / 4);
}

function estimateMessageChars(message: ChatMessage): number {
  return contentText(message).length + JSON.stringify(message.tool_calls ?? []).length;
}

function contentText(message: ChatMessage | undefined): string {
  return typeof message?.content === "string" ? message.content : "";
}

export const OBSERVATION_TARGET_TOKEN_BUDGET = TARGET_TOKEN_BUDGET;
