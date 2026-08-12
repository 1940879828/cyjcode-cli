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

  if (header) {
    appendHeaderRows(rows, header, width);
  }

  entries.forEach((entry) => appendEntryRows(rows, entry, width));

  if (streamingReasoning) {
    appendThinkingRows(rows, "streaming_reasoning", streamingReasoning, width);
  }

  if (streamingAssistantTurn) {
    appendAssistantTurnRows(rows, streamingAssistantTurn, width);
  }

  return rows;
};

const appendHeaderRows = (
  rows: TranscriptRow[],
  header: TranscriptHeader,
  width: number,
) => {
  const boxWidth = Math.max(4, Math.min(HEADER_WIDTH, width));
  const innerWidth = boxWidth - 2;
  const headerRows = [
    createHeaderRow(`╭${"─".repeat(innerWidth)}╮`),
    createHeaderTitleRow(innerWidth, header.version),
    createHeaderRow(`│${" ".repeat(innerWidth)}│`),
    createHeaderInfoRow("Model", header.model, innerWidth),
    createHeaderInfoRow("Thinking", header.thinking ? "Enabled" : "Disabled", innerWidth),
    createHeaderInfoRow("Reasoning Effort", header.reasoningEffort, innerWidth),
    createHeaderInfoRow("Path", header.path, innerWidth),
    createHeaderRow(`╰${"─".repeat(innerWidth)}╯`),
    createHeaderRow(""),
  ];

  headerRows.forEach((row, index) => rows.push({ ...row, id: `header_${index}` }));
};

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
  const leftSegments = [
    { text: ">_ ", color: ENERGY_GOLD, bold: true },
    { text: "Tiga", color: TIGA_RED, bold: true },
    { text: " Code", color: TIMER_BLUE, bold: true },
  ];
  const rightText = truncateByColumns(`(V${version})`, innerWidth);
  const leftText = leftSegments.map((segment) => segment.text).join("");
  const gap = Math.max(0, innerWidth - stringWidth(leftText) - stringWidth(rightText));
  const segments = [
    { text: "│", color: BORDER_COLOR },
    ...leftSegments,
    { text: " ".repeat(gap), color: BORDER_COLOR },
    { text: rightText, color: ENERGY_GOLD, bold: true },
    { text: "│", color: BORDER_COLOR },
  ];

  return createHeaderRow(segments.map((segment) => segment.text).join(""), segments);
};

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
  if (stringWidth(text) <= width) {
    return text;
  }
  if (width <= 1) {
    return "";
  }

  const ellipsis = "…";
  let result = "";
  let resultWidth = stringWidth(ellipsis);
  for (const cluster of splitGraphemes(text)) {
    const clusterWidth = Math.max(1, stringWidth(cluster));
    if (resultWidth + clusterWidth > width) {
      break;
    }
    result += cluster;
    resultWidth += clusterWidth;
  }
  return `${result}${ellipsis}`;
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

  const { kind, firstPrefix, restPrefix } = getTextEntryRowConfig(entry);
  if (kind === "thinking") {
    appendThinkingRows(rows, entry.id, entry.content, width);
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

const getTextEntryRowConfig = (
  entry: TextChatEntry,
): {
  kind: TranscriptRowKind;
  firstPrefix: string;
  restPrefix: string;
} => {
  switch (entry.role) {
    case "user":
      return { kind: "user", firstPrefix: USER_PREFIX, restPrefix: CONTINUATION_PREFIX };
    case "thinking":
      return { kind: "thinking", firstPrefix: "Thinking: ", restPrefix: CONTINUATION_PREFIX };
    case "tool_call":
    case "tool_result":
      return { kind: "tool", firstPrefix: "", restPrefix: CONTINUATION_PREFIX };
    case "error":
      return { kind: "error", firstPrefix: "Error: ", restPrefix: CONTINUATION_PREFIX };
    case "system":
      return { kind: "system", firstPrefix: "", restPrefix: "" };
  }
};

const appendThinkingRows = (
  rows: TranscriptRow[],
  id: string,
  content: string,
  width: number,
) => {
  appendSpacerRow(rows, `${id}_before`);
  appendWrappedRows(rows, {
    id,
    kind: "thinking",
    content,
    width,
    firstPrefix: "Thinking: ",
    restPrefix: CONTINUATION_PREFIX,
  });
  appendSpacerRow(rows, `${id}_after`);
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
  turn.parts.forEach((part) => {
    appendWrappedRows(rows, {
      id: part.id,
      kind: getAssistantPartRowKind(part.kind),
      content: part.content,
      width,
      firstPrefix: part.kind === "text" ? ASSISTANT_PREFIX : CONTINUATION_PREFIX,
      restPrefix: CONTINUATION_PREFIX,
    });
  });

  if (turn.activeText) {
    appendWrappedRows(rows, {
      id: `${turn.id}_active`,
      kind: "assistant",
      content: turn.activeText,
      width,
      firstPrefix: ASSISTANT_PREFIX,
      restPrefix: CONTINUATION_PREFIX,
    });
  }
};

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
    const prefix = index === 0 ? options.firstPrefix : options.restPrefix;
    rows.push({
      id: `${options.id}_${index}`,
      kind: options.kind,
      text: `${prefix}${line}`,
      ...ROLE_STYLES[options.kind],
    });
  });
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
  if (!line) {
    return [""];
  }

  const rows: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const cluster of splitGraphemes(line)) {
    const clusterWidth = Math.max(1, stringWidth(cluster));
    if (current && currentWidth + clusterWidth > width) {
      rows.push(current);
      current = cluster;
      currentWidth = clusterWidth;
      continue;
    }

    current += cluster;
    currentWidth += clusterWidth;
  }

  rows.push(current);
  return rows;
};

const wrapLogicalLineWithFirstWidth = (
  line: string,
  firstWidth: number,
  restWidth: number,
): string[] => {
  if (!line) {
    return [""];
  }

  const rows: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const cluster of splitGraphemes(line)) {
    const availableWidth = rows.length === 0 ? firstWidth : restWidth;
    const clusterWidth = Math.max(1, stringWidth(cluster));
    if (current && currentWidth + clusterWidth > availableWidth) {
      rows.push(current);
      current = cluster;
      currentWidth = clusterWidth;
      continue;
    }

    current += cluster;
    currentWidth += clusterWidth;
  }

  rows.push(current);
  return rows;
};

const splitGraphemes = (text: string): string[] => {
  if (typeof Intl.Segmenter !== "function") {
    return Array.from(text);
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (segment) => segment.segment);
};
