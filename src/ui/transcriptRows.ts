import stringWidth from "string-width";
import type { AssistantTurn, AssistantTurnPartKind } from "./assistantTurn.js";
import type { ChatEntry, TextChatEntry } from "./hooks/index.js";

export type TranscriptRowKind =
  | "header"
  | "spacer"
  | "system"
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "error";

export interface TranscriptRow {
  id: string;
  kind: TranscriptRowKind;
  text: string;
  segments?: TranscriptRowSegment[];
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dimColor?: boolean;
}

export interface TranscriptRowSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

export interface BuildTranscriptRowsInput {
  header?: TranscriptHeader;
  entries: readonly ChatEntry[];
  streamingReasoning: string;
  streamingAssistantTurn: AssistantTurn | null;
  width: number;
}

export interface TranscriptHeader {
  version: string;
  model: string;
  thinking: boolean;
  reasoningEffort: string;
  path: string;
}

const MIN_WRAP_WIDTH = 8;
const HEADER_WIDTH = 60;
const BORDER_COLOR = "#E6EBF2";
const TIGA_RED = "#E24B5A";
const TIMER_BLUE = "#55A8E8";
const ENERGY_GOLD = "#FFD75F";
const VALUE_COLOR = "#F5F7FF";
const USER_PREFIX = "❯ ";
const ASSISTANT_PREFIX = "● ";
const CONTINUATION_PREFIX = "  ";
const SELECTION_HINT = "提示: 可滚轮浏览内容，按住 Shift 拖拽选择文字";

interface ThinkingRowsInput {
  rows: TranscriptRow[];
  id: string;
  content: string;
  width: number;
  showSelectionHint: boolean;
}

interface WrapState {
  rows: string[];
  current: string;
  currentWidth: number;
}

const ROLE_STYLES: Record<TranscriptRowKind, Omit<TranscriptRow, "id" | "kind" | "text">> = {
  header: { color: "#E6EBF2" },
  spacer: {},
  system: {},
  user: { color: "#f5f5f5", backgroundColor: "#373737", bold: true },
  assistant: { color: "#f2f2f2" },
  thinking: { color: "yellow", dimColor: true },
  tool: { color: "yellow" },
  error: { color: "red" },
};

export const buildTranscriptRows = ({
  header,
  entries,
  streamingReasoning,
  streamingAssistantTurn,
  width,
}: BuildTranscriptRowsInput): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];

  if (header) appendHeaderRows(rows, header, width);

  entries.forEach((entry) => appendEntryRows(rows, entry, width));

  appendStreamingRows(rows, { streamingReasoning, streamingAssistantTurn, width });
  return rows;
};

const appendStreamingRows = (
  rows: TranscriptRow[],
  input: Pick<BuildTranscriptRowsInput, "streamingReasoning" | "streamingAssistantTurn" | "width">,
) => {
  if (input.streamingReasoning) {
    appendThinkingRows({
      rows,
      id: "streaming_reasoning",
      content: input.streamingReasoning,
      width: input.width,
      showSelectionHint: false,
    });
  }

  if (input.streamingAssistantTurn) {
    appendAssistantTurnRows(rows, input.streamingAssistantTurn, input.width);
  }
};

const appendHeaderRows = (
  rows: TranscriptRow[],
  header: TranscriptHeader,
  width: number,
) => {
  const boxWidth = Math.max(4, Math.min(HEADER_WIDTH, width));
  const innerWidth = boxWidth - 2;
  buildHeaderRows(header, innerWidth)
    .forEach((row, index) => rows.push({ ...row, id: `header_${index}` }));
};

const buildHeaderRows = (
  header: TranscriptHeader,
  innerWidth: number,
): Array<Omit<TranscriptRow, "id">> => [
    createHeaderRow(`╭${"─".repeat(innerWidth)}╮`),
    createHeaderTitleRow(innerWidth, header.version),
    createHeaderRow(`│${" ".repeat(innerWidth)}│`),
    createHeaderInfoRow("Model", header.model, innerWidth),
    createHeaderInfoRow("Thinking", header.thinking ? "Enabled" : "Disabled", innerWidth),
    createHeaderInfoRow("Reasoning Effort", formatReasoningEffort(header.thinking, header.reasoningEffort), innerWidth),
    createHeaderInfoRow("Path", header.path, innerWidth),
    createHeaderRow(`╰${"─".repeat(innerWidth)}╯`),
  ];

const createHeaderRow = (
  text: string,
  segments?: TranscriptRowSegment[],
): Omit<TranscriptRow, "id"> => ({
  kind: "header",
  text,
  segments: segments ?? [{ text, color: BORDER_COLOR }],
  ...ROLE_STYLES.header,
});

const createHeaderTitleRow = (
  innerWidth: number,
  version: string,
): Omit<TranscriptRow, "id"> => {
  const leftSegments = createHeaderTitleSegments();
  const rightText = truncateByColumns(`(V${version})`, innerWidth);
  const leftText = leftSegments.map((segment) => segment.text).join("");
  const gap = Math.max(0, innerWidth - stringWidth(leftText) - stringWidth(rightText));
  const segments = wrapHeaderTitleSegments(leftSegments, rightText, gap);

  return createHeaderRow(segments.map((segment) => segment.text).join(""), segments);
};

const createHeaderTitleSegments = (): TranscriptRowSegment[] => [
  { text: ">_ ", color: ENERGY_GOLD, bold: true },
  { text: "Tiga", color: TIGA_RED, bold: true },
  { text: " Code", color: TIMER_BLUE, bold: true },
];

const wrapHeaderTitleSegments = (
  leftSegments: TranscriptRowSegment[],
  rightText: string,
  gap: number,
): TranscriptRowSegment[] => [
  { text: "│", color: BORDER_COLOR },
  ...leftSegments,
  { text: " ".repeat(gap), color: BORDER_COLOR },
  { text: rightText, color: ENERGY_GOLD, bold: true },
  { text: "│", color: BORDER_COLOR },
];

const formatReasoningEffort = (thinking: boolean, reasoningEffort: string): string =>
  thinking ? reasoningEffort : "N/A";

const createHeaderInfoRow = (
  label: string,
  value: string,
  innerWidth: number,
): Omit<TranscriptRow, "id"> => {
  const safeLabel = truncateByColumns(label, Math.max(0, innerWidth - 1));
  const safeValue = truncateByColumns(value, Math.max(0, innerWidth - stringWidth(safeLabel)));
  const gap = Math.max(0, innerWidth - stringWidth(safeLabel) - stringWidth(safeValue));
  const segments = [
    { text: "│", color: BORDER_COLOR },
    { text: safeLabel, color: BORDER_COLOR, bold: true },
    { text: " ".repeat(gap), color: BORDER_COLOR },
    { text: safeValue, color: VALUE_COLOR, bold: true },
    { text: "│", color: BORDER_COLOR },
  ];

  return createHeaderRow(segments.map((segment) => segment.text).join(""), segments);
};

const truncateByColumns = (text: string, width: number): string => {
  if (stringWidth(text) <= width) return text;
  if (width <= 1) return "";

  const ellipsis = "…";
  const truncated = takeColumns(text, width - stringWidth(ellipsis));
  return `${truncated}${ellipsis}`;
};

const takeColumns = (text: string, width: number): string => {
  let result = "";
  let resultWidth = 0;
  for (const cluster of splitGraphemes(text)) {
    const clusterWidth = Math.max(1, stringWidth(cluster));
    if (resultWidth + clusterWidth > width) break;
    result += cluster;
    resultWidth += clusterWidth;
  }
  return result;
};

export const wrapTextByColumns = (text: string, width: number): string[] => {
  const wrapWidth = Math.max(1, width);
  const logicalLines = text.split(/\n/);
  return logicalLines.flatMap((line) => wrapLogicalLine(line, wrapWidth));
};

const appendEntryRows = (
  rows: TranscriptRow[],
  entry: ChatEntry,
  width: number,
) => {
  if (entry.role === "assistant") {
    appendAssistantTurnRows(rows, entry, width);
    return;
  }

  appendTextEntryRows(rows, entry, width);
};

const appendTextEntryRows = (
  rows: TranscriptRow[],
  entry: TextChatEntry,
  width: number,
) => {
  const { kind, firstPrefix, restPrefix } = getTextEntryRowConfig(entry);
  if (kind === "thinking") {
    appendCompletedThinkingRows(rows, entry, width);
    return;
  }

  appendWrappedRows(rows, {
    id: entry.id,
    kind,
    content: entry.content,
    width,
    firstPrefix,
    restPrefix,
  });
};

const TEXT_ENTRY_CONFIGS: Record<TextChatEntry["role"], {
  kind: TranscriptRowKind;
  firstPrefix: string;
  restPrefix: string;
}> = {
  user: { kind: "user", firstPrefix: USER_PREFIX, restPrefix: CONTINUATION_PREFIX },
  thinking: { kind: "thinking", firstPrefix: "Thinking: ", restPrefix: CONTINUATION_PREFIX },
  tool_call: { kind: "tool", firstPrefix: "", restPrefix: CONTINUATION_PREFIX },
  tool_result: { kind: "tool", firstPrefix: "", restPrefix: CONTINUATION_PREFIX },
  error: { kind: "error", firstPrefix: "Error: ", restPrefix: CONTINUATION_PREFIX },
  system: { kind: "system", firstPrefix: "", restPrefix: "" },
};

const getTextEntryRowConfig = (
  entry: TextChatEntry,
): {
  kind: TranscriptRowKind;
  firstPrefix: string;
  restPrefix: string;
} => TEXT_ENTRY_CONFIGS[entry.role];

const appendThinkingRows = (input: ThinkingRowsInput) => {
  appendSpacerRow(input.rows, `${input.id}_before`);
  appendWrappedRows(input.rows, {
    id: input.id,
    kind: "thinking",
    content: input.content,
    width: input.width,
    firstPrefix: "Thinking: ",
    restPrefix: CONTINUATION_PREFIX,
  });
  if (input.showSelectionHint) appendSelectionHintRow(input.rows, input.id);
  appendSpacerRow(input.rows, `${input.id}_after`);
};

const appendCompletedThinkingRows = (
  rows: TranscriptRow[],
  entry: TextChatEntry,
  width: number,
) => {
  appendThinkingRows({
    rows,
    id: entry.id,
    content: entry.content,
    width,
    showSelectionHint: true,
  });
};

const appendSelectionHintRow = (rows: TranscriptRow[], id: string) => {
  rows.push({
    id: `${id}_selection_hint`,
    kind: "thinking",
    text: `${CONTINUATION_PREFIX}${SELECTION_HINT}`,
    color: "gray",
    dimColor: true,
  });
};

const appendSpacerRow = (rows: TranscriptRow[], id: string) => {
  rows.push({
    id,
    kind: "spacer",
    text: "",
  });
};

const appendAssistantTurnRows = (
  rows: TranscriptRow[],
  turn: AssistantTurn,
  width: number,
) => {
  turn.parts.forEach((part) => appendAssistantPartRows(rows, part, width));

  if (turn.activeText) appendActiveAssistantRow(rows, turn, width);
  appendSpacerRow(rows, `${turn.id}_after`);
};

const appendAssistantPartRows = (
  rows: TranscriptRow[],
  part: AssistantTurn["parts"][number],
  width: number,
) => appendWrappedRows(rows, {
  id: part.id,
  kind: getAssistantPartRowKind(part.kind),
  content: part.content,
  width,
  firstPrefix: part.kind === "text" ? ASSISTANT_PREFIX : CONTINUATION_PREFIX,
  restPrefix: CONTINUATION_PREFIX,
});

const appendActiveAssistantRow = (
  rows: TranscriptRow[],
  turn: AssistantTurn,
  width: number,
) => appendWrappedRows(rows, {
  id: `${turn.id}_active`,
  kind: "assistant",
  content: turn.activeText,
  width,
  firstPrefix: ASSISTANT_PREFIX,
  restPrefix: CONTINUATION_PREFIX,
});

const getAssistantPartRowKind = (
  kind: AssistantTurnPartKind,
): TranscriptRowKind => {
  if (kind === "tool") {
    return "tool";
  }
  if (kind === "error") {
    return "error";
  }
  return "assistant";
};

const appendWrappedRows = (
  rows: TranscriptRow[],
  options: {
    id: string;
    kind: TranscriptRowKind;
    content: string;
    width: number;
    firstPrefix: string;
    restPrefix: string;
  },
) => {
  const firstWidth = Math.max(MIN_WRAP_WIDTH, options.width - stringWidth(options.firstPrefix));
  const restWidth = Math.max(MIN_WRAP_WIDTH, options.width - stringWidth(options.restPrefix));
  const wrappedLines = wrapTextWithContinuation(options.content, firstWidth, restWidth);

  wrappedLines.forEach((line, index) => {
    rows.push(createWrappedRow(options, line, index));
  });
};

const createWrappedRow = (
  options: Parameters<typeof appendWrappedRows>[1],
  line: string,
  index: number,
): TranscriptRow => {
  const prefix = index === 0 ? options.firstPrefix : options.restPrefix;
  return {
    id: `${options.id}_${index}`,
    kind: options.kind,
    text: `${prefix}${line}`,
    ...ROLE_STYLES[options.kind],
  };
};

const wrapTextWithContinuation = (
  text: string,
  firstWidth: number,
  restWidth: number,
): string[] => {
  const rows: string[] = [];
  text.split(/\n/).forEach((line) => {
    const wrapped = wrapLogicalLineWithFirstWidth(
      line,
      rows.length === 0 ? firstWidth : restWidth,
      restWidth,
    );
    rows.push(...wrapped);
  });
  return rows.length > 0 ? rows : [""];
};

const wrapLogicalLine = (line: string, width: number): string[] => {
  return wrapLogicalLineWithWidths(line, width, width);
};

const wrapLogicalLineWithFirstWidth = (
  line: string,
  firstWidth: number,
  restWidth: number,
): string[] => {
  return wrapLogicalLineWithWidths(line, firstWidth, restWidth);
};

const wrapLogicalLineWithWidths = (
  line: string,
  firstWidth: number,
  restWidth: number,
): string[] => {
  if (!line) return [""];
  const state: WrapState = { rows: [], current: "", currentWidth: 0 };
  for (const cluster of splitGraphemes(line)) {
    appendCluster(state, cluster, state.rows.length === 0 ? firstWidth : restWidth);
  }
  return finishWrapState(state);
};

const appendCluster = (state: WrapState, cluster: string, width: number): void => {
  const clusterWidth = Math.max(1, stringWidth(cluster));
  if (state.current && state.currentWidth + clusterWidth > width) {
    state.rows.push(state.current);
    state.current = cluster;
    state.currentWidth = clusterWidth;
    return;
  }
  state.current += cluster;
  state.currentWidth += clusterWidth;
};

const finishWrapState = (state: WrapState): string[] => {
  state.rows.push(state.current);
  return state.rows;
};

const splitGraphemes = (text: string): string[] => {
  if (typeof Intl.Segmenter !== "function") {
    return Array.from(text);
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (segment) => segment.segment);
};
