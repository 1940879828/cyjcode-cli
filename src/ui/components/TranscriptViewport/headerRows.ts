import stringWidth from "string-width";
import { TIGA_ART } from "./headerArt.js";
import {
  BORDER_COLOR,
  ENERGY_GOLD,
  HEADER_WIDTH,
  ROLE_STYLES,
  TIGA_RED,
  TIMER_BLUE,
  VALUE_COLOR,
  createSpacerRow,
} from "./transcriptTheme.js";
import type { TranscriptHeader, TranscriptRow, TranscriptRowSegment } from "./transcriptTypes.js";
import { truncateByColumns } from "./wrapByColumns.js";

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

const appendHeaderRows = (
  rows: TranscriptRow[],
  header: TranscriptHeader,
  width: number,
) => {
  const boxWidth = Math.max(4, Math.min(HEADER_WIDTH, width));
  const innerWidth = boxWidth - 2;
  buildHeaderRows(header, innerWidth)
    .forEach((row, index) => rows.push({ ...row, id: `header_${index}` }));
  rows.push(createSpacerRow("header_after"));
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
