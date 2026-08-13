import stringWidth from "string-width";
import type { WrappedLine } from "./transcriptTypes.js";

interface WrapCursor {
  rows: WrappedLine[];
  current: string;
  currentWidth: number;
  lineStart: number;
  lineLength: number;
}

export const truncateByColumns = (text: string, width: number): string => {
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

export const wrapTextWithContinuation = (
  text: string,
  firstWidth: number,
  restWidth: number,
): WrappedLine[] => {
  const rows: WrappedLine[] = [];
  let baseOffset = 0;
  text.split(/\n/).forEach((line) => {
    const wrapped = wrapLogicalLineWithWidths(
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

const wrapLogicalLine = (line: string, width: number): string[] =>
  wrapLogicalLineWithWidths(line, width, width).map((part) => part.text);

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
