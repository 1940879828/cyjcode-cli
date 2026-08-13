import stringWidth from "string-width";
import type { AssistantTurn, AssistantTurnPartKind } from "../../assistantTurn.js";
import type { ChatEntry, TextChatEntry } from "../../hooks/index.js";
import { TIGA_ART } from "./headerArt.js";

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
  /** 行在源文本中的出处；装饰行（header/分隔/hint）无 source */
  source?: TranscriptRowSource;
}

export interface TranscriptRowSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

/** 源文本单元：id 与行 source.sourceId 对应，text 为未经折行的原文 */
export interface TranscriptSourceUnit {
  id: string;
  text: string;
}

/** 源文本字符区间 + 行内装饰前缀；offset 为 JS 字符索引 */
export interface TranscriptRowSource {
  sourceId: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
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
const SELECTION_HINT = "提示: 可拖拽选择文字，滚轮浏览内容";

interface ThinkingRowsInput {
  rows: TranscriptRow[];
  id: string;
  content: string;
  width: number;
  showSelectionHint: boolean;
}

interface AssistantBoundaryInput {
  rows: TranscriptRow[];
  turnId: string;
  previousBlock: AssistantBlockKind | null;
  currentBlock: AssistantBlockKind;
  index: number;
}

interface ActiveAssistantBlockInput {
  rows: TranscriptRow[];
  turn: AssistantTurn;
  width: number;
  previousBlock: AssistantBlockKind | null;
}

/** 折行产物：text 为该物理行内容，offset 为该行在源文本中的字符区间 */
interface WrappedLine {
  text: string;
  startOffset: number;
  endOffset: number;
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
  return [
    ...(header ? buildTranscriptHeaderRows({ header, width }) : []),
    ...entries.flatMap((entry) => buildTranscriptEntryRows({ entry, width })),
    ...buildTranscriptStreamingRows({ streamingReasoning, streamingAssistantTurn, width }),
  ];
};

export const buildTranscriptHeaderRows = ({
  header,
  width,
}: {
  header: TranscriptHeader;
  width: number;
}): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];
  appendHeaderRows(rows, header, width);
  return rows;
};

export const buildTranscriptEntryRows = ({
  entry,
  width,
}: {
  entry: ChatEntry;
  width: number;
}): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];
  appendEntryRows(rows, entry, width);
  return rows;
};

export const buildTranscriptStreamingRows = (
  input: Pick<BuildTranscriptRowsInput, "streamingReasoning" | "streamingAssistantTurn" | "width">,
): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];
  appendStreamingRows(rows, input);
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
  appendSpacerRow(rows, "header_after");
};

const buildHeaderRows = (
  header: TranscriptHeader,
  innerWidth: number,
): Array<Omit<TranscriptRow, "id">> => [
    ...createHeaderArtRows(),
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

const createHeaderArtRows = (): Array<Omit<TranscriptRow, "id">> =>
  TIGA_ART.split("\n").map((line) => createHeaderRow(line));

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

  appendRegularTextRows(rows, { entry, kind, firstPrefix, restPrefix, width });
};

const appendRegularTextRows = (
  rows: TranscriptRow[],
  input: {
    entry: TextChatEntry;
    kind: TranscriptRowKind;
    firstPrefix: string;
    restPrefix: string;
    width: number;
  },
) => {
  appendWrappedRows(rows, {
    id: input.entry.id,
    kind: input.kind,
    content: input.entry.content,
    width: input.width,
    firstPrefix: input.firstPrefix,
    restPrefix: input.restPrefix,
  });
  if (shouldAppendBlockSpacer(input.entry)) appendSpacerRow(rows, `${input.entry.id}_after`);
};

const shouldAppendBlockSpacer = (entry: TextChatEntry): boolean =>
  entry.role === "system";

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
  const previousBlock = appendAssistantPartBlocks(rows, turn, width);
  appendActiveAssistantBlock({ rows, turn, width, previousBlock });
  appendSpacerRow(rows, `${turn.id}_after`);
};

type AssistantBlockKind = "text" | "tool";

const appendAssistantPartBlocks = (
  rows: TranscriptRow[],
  turn: AssistantTurn,
  width: number,
): AssistantBlockKind | null => {
  let previousBlock: AssistantBlockKind | null = null;
  turn.parts.forEach((part, index) => {
    previousBlock = appendAssistantBoundary({
      rows,
      turnId: turn.id,
      previousBlock,
      currentBlock: getAssistantBlockKind(part.kind),
      index,
    });
    appendAssistantPartRows(rows, part, width);
  });
  return previousBlock;
};

const appendActiveAssistantBlock = (input: ActiveAssistantBlockInput) => {
  if (!input.turn.activeText) return;
  appendAssistantBoundary({
    rows: input.rows,
    turnId: input.turn.id,
    previousBlock: input.previousBlock,
    currentBlock: "text",
    index: input.turn.parts.length,
  });
  appendActiveAssistantRow(input.rows, input.turn, input.width);
};

const appendAssistantBoundary = (input: AssistantBoundaryInput): AssistantBlockKind => {
  if (input.previousBlock && input.previousBlock !== input.currentBlock) {
    appendSpacerRow(input.rows, `${input.turnId}_block_${input.index}_before`);
  }
  return input.currentBlock;
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

const getAssistantBlockKind = (kind: AssistantTurnPartKind): AssistantBlockKind =>
  kind === "text" ? "text" : "tool";

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
  line: WrappedLine,
  index: number,
): TranscriptRow => {
  const prefix = index === 0 ? options.firstPrefix : options.restPrefix;
  return {
    id: `${options.id}_${index}`,
    kind: options.kind,
    text: `${prefix}${line.text}`,
    source: {
      sourceId: options.id,
      startOffset: line.startOffset,
      endOffset: line.endOffset,
      prefix,
    },
    ...ROLE_STYLES[options.kind],
  };
};

const wrapTextWithContinuation = (
  text: string,
  firstWidth: number,
  restWidth: number,
): WrappedLine[] => {
  const rows: WrappedLine[] = [];
  let baseOffset = 0;
  text.split(/\n/).forEach((line) => {
    const wrapped = wrapLogicalLineWithFirstWidth(
      line,
      rows.length === 0 ? firstWidth : restWidth,
      restWidth,
    );
    rows.push(...wrapped.map((part) => shiftWrappedLine(part, baseOffset)));
    baseOffset += line.length + 1;
  });
  return rows.length > 0 ? rows : [{ text: "", startOffset: 0, endOffset: 0 }];
};

const shiftWrappedLine = (line: WrappedLine, offset: number): WrappedLine => ({
  text: line.text,
  startOffset: line.startOffset + offset,
  endOffset: line.endOffset + offset,
});

const wrapLogicalLine = (line: string, width: number): string[] => {
  return wrapLogicalLineWithWidths(line, width, width).map((part) => part.text);
};

const wrapLogicalLineWithFirstWidth = (
  line: string,
  firstWidth: number,
  restWidth: number,
): WrappedLine[] => {
  return wrapLogicalLineWithWidths(line, firstWidth, restWidth);
};

// 折行游标：lineStart/lineLength 跟踪当前物理行在逻辑行内的字符区间
interface WrapCursor {
  rows: WrappedLine[];
  current: string;
  currentWidth: number;
  lineStart: number;
  lineLength: number;
}

const wrapLogicalLineWithWidths = (
  line: string,
  firstWidth: number,
  restWidth: number,
): WrappedLine[] => {
  if (!line) return [{ text: "", startOffset: 0, endOffset: 0 }];
  const state: WrapCursor = { rows: [], current: "", currentWidth: 0, lineStart: 0, lineLength: 0 };
  for (const cluster of splitGraphemes(line)) {
    appendCluster(state, cluster, state.rows.length === 0 ? firstWidth : restWidth);
  }
  return finishWrapState(state);
};

const appendCluster = (state: WrapCursor, cluster: string, width: number): void => {
  const clusterWidth = Math.max(1, stringWidth(cluster));
  if (state.current && state.currentWidth + clusterWidth > width) {
    state.rows.push({
      text: state.current,
      startOffset: state.lineStart,
      endOffset: state.lineStart + state.lineLength,
    });
    state.lineStart += state.lineLength;
    state.current = cluster;
    state.currentWidth = clusterWidth;
    state.lineLength = cluster.length;
    return;
  }
  state.current += cluster;
  state.currentWidth += clusterWidth;
  state.lineLength += cluster.length;
};

const finishWrapState = (state: WrapCursor): WrappedLine[] => {
  state.rows.push({
    text: state.current,
    startOffset: state.lineStart,
    endOffset: state.lineStart + state.lineLength,
  });
  return state.rows;
};

export const splitGraphemes = (text: string): string[] => {
  if (typeof Intl.Segmenter !== "function") {
    return Array.from(text);
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (segment) => segment.segment);
};

/** 源文本单元枚举，顺序与行构建一致；选中与复制都以它为基准 */
export const buildTranscriptSources = (
  input: Pick<BuildTranscriptRowsInput, "entries" | "streamingReasoning" | "streamingAssistantTurn">,
): TranscriptSourceUnit[] => {
  const sources: TranscriptSourceUnit[] = [];
  for (const entry of input.entries) {
    appendEntrySources(sources, entry);
  }
  if (input.streamingReasoning) {
    sources.push({ id: "streaming_reasoning", text: input.streamingReasoning });
  }
  if (input.streamingAssistantTurn) {
    appendTurnSources(sources, input.streamingAssistantTurn);
  }
  return sources;
};

const appendEntrySources = (sources: TranscriptSourceUnit[], entry: ChatEntry) => {
  if (entry.role === "assistant") {
    appendTurnSources(sources, entry);
    return;
  }
  sources.push({ id: entry.id, text: entry.content });
};

const appendTurnSources = (sources: TranscriptSourceUnit[], turn: AssistantTurn) => {
  for (const part of turn.parts) {
    sources.push({ id: part.id, text: part.content });
  }
  if (turn.activeText) {
    sources.push({ id: `${turn.id}_active`, text: turn.activeText });
  }
};
