import stringWidth from "string-width";
import type {
  TranscriptRow,
  TranscriptRowSegment,
  TranscriptRowSource,
  TranscriptSourceUnit,
} from "./transcriptRows.js";
import { splitGraphemes } from "./transcriptRows.js";

export type TranscriptSelectAction = "start" | "extend" | "end";

export const SELECTION_BACKGROUND = "#264F78";

/** col/row 为 SGR 上报的 1-based 终端坐标。 */
export interface TranscriptSelectEvent {
  action: TranscriptSelectAction;
  col: number;
  row: number;
}

/**
 * 选中点绑定源文本层：sourceId 为源单元 id，offset 为源文本内的字符索引。
 * 滚动、折行、流式追加、窗口变化都不会改变指向；复制直接切片原文（无前缀、无折行假换行）。
 */
export interface TranscriptSelectionPoint {
  sourceId: string;
  offset: number;
}

export interface TranscriptSelection {
  anchor: TranscriptSelectionPoint;
  active: TranscriptSelectionPoint;
}

export interface RowSelectionRange {
  fromCol: number;
  toCol: number;
}

export interface RowSelectionPart {
  text: string;
  selected: boolean;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

export interface SourceSelectionBounds {
  startIndex: number;
  endIndex: number;
  startOffset: number;
  endOffset: number;
}

interface TranscriptSelectionReduceInput {
  event: TranscriptSelectEvent;
  selection: TranscriptSelection | null;
  visibleRows: readonly TranscriptRow[];
  sources: readonly TranscriptSourceUnit[];
}

interface RowSourceSelection {
  prefix: string;
  fragment: string;
  relativeStartOffset: number;
  relativeEndOffset: number;
}

interface OffsetRange {
  from: number;
  to: number;
}

export interface TranscriptSelectionReduceResult {
  selection: TranscriptSelection | null;
  copyText: string | null;
}

export const reduceTranscriptSelectionEvent = ({
  event,
  selection,
  visibleRows,
  sources,
}: TranscriptSelectionReduceInput): TranscriptSelectionReduceResult => {
  if (event.action === "start") {
    const point = toStartPoint(event, visibleRows);
    if (!point) return { selection: null, copyText: null };
    return { selection: createTranscriptSelection(point), copyText: null };
  }
  if (event.action === "extend") {
    if (!selection) return { selection, copyText: null };
    const point = toClampedPoint(event, visibleRows);
    return { selection: point ? extendTranscriptSelection(selection, point) : selection, copyText: null };
  }
  return finishTranscriptSelection(getEndSelection(event, selection, visibleRows), sources);
};

export const createTranscriptSelection = (
  point: TranscriptSelectionPoint,
): TranscriptSelection => ({ anchor: point, active: point });

export const extendTranscriptSelection = (
  selection: TranscriptSelection,
  point: TranscriptSelectionPoint,
): TranscriptSelection => ({ anchor: selection.anchor, active: point });

export const resolveSelectionBounds = (
  selection: TranscriptSelection,
  indexOf: (sourceId: string) => number,
): SourceSelectionBounds | null => {
  const anchorIndex = indexOf(selection.anchor.sourceId);
  const activeIndex = indexOf(selection.active.sourceId);
  if (anchorIndex < 0 || activeIndex < 0) return null;
  const anchorFirst = isPointFirst(
    { index: anchorIndex, offset: selection.anchor.offset },
    { index: activeIndex, offset: selection.active.offset },
  );
  const start = anchorFirst ? selection.anchor : selection.active;
  const end = anchorFirst ? selection.active : selection.anchor;
  return {
    startIndex: anchorFirst ? anchorIndex : activeIndex,
    endIndex: anchorFirst ? activeIndex : anchorIndex,
    startOffset: start.offset,
    endOffset: end.offset,
  };
};

export const isDegenerateSelection = (bounds: SourceSelectionBounds): boolean =>
  bounds.startIndex === bounds.endIndex && bounds.startOffset === bounds.endOffset;

export const createSourceIndexLookup = (
  sources: readonly TranscriptSourceUnit[],
): ((sourceId: string) => number) => {
  const indexById = new Map(sources.map((source, index) => [source.id, index]));
  return (sourceId) => indexById.get(sourceId) ?? -1;
};

export const getUnitSelectionRange = (
  bounds: SourceSelectionBounds,
  unitIndex: number,
): { from: number; to: number } | null => {
  if (unitIndex < bounds.startIndex || unitIndex > bounds.endIndex) return null;
  const from = unitIndex === bounds.startIndex ? bounds.startOffset : 0;
  const to = unitIndex === bounds.endIndex ? bounds.endOffset : Number.POSITIVE_INFINITY;
  return from >= to ? null : { from, to };
};

export const buildSelectedText = (
  sources: readonly TranscriptSourceUnit[],
  selection: TranscriptSelection,
): string => {
  const bounds = resolveSelectionBounds(selection, createSourceIndexLookup(sources));
  if (!bounds) return "";
  const lines: string[] = [];
  for (let unitIndex = bounds.startIndex; unitIndex <= bounds.endIndex; unitIndex++) {
    const range = getUnitSelectionRange(bounds, unitIndex);
    if (!range) continue;
    lines.push(sources[unitIndex].text.slice(range.from, range.to));
  }
  return lines.join("\n");
};

export const buildSelectionRowRanges = (
  selection: TranscriptSelection | null,
  sources: readonly TranscriptSourceUnit[],
  visibleRows: readonly TranscriptRow[],
): ReadonlyMap<string, RowSelectionRange> => {
  const ranges = new Map<string, RowSelectionRange>();
  if (!selection) return ranges;
  const indexOf = createSourceIndexLookup(sources);
  const bounds = resolveSelectionBounds(selection, indexOf);
  if (!bounds) return ranges;
  for (const row of visibleRows) {
    const range = getRowSelectionRangeForRow(bounds, indexOf, row);
    if (range) ranges.set(row.id, range);
  }
  return ranges;
};

const getRowSelectionRangeForRow = (
  bounds: SourceSelectionBounds,
  indexOf: (sourceId: string) => number,
  row: TranscriptRow,
): RowSelectionRange | null => {
  const selection = getRowSourceSelection(bounds, indexOf, row);
  if (!selection) return null;
  const [fromCol, toCol] = measureColumnRange(
    selection.fragment,
    selection.relativeStartOffset,
    selection.relativeEndOffset,
  );
  const prefixCells = stringWidth(selection.prefix);
  return { fromCol: prefixCells + fromCol, toCol: prefixCells + toCol };
};

const getRowSourceSelection = (
  bounds: SourceSelectionBounds,
  indexOf: (sourceId: string) => number,
  row: TranscriptRow,
): RowSourceSelection | null => {
  if (!row.source) return null;
  const overlap = getRowSourceOverlap(bounds, indexOf, row.source);
  if (!overlap) return null;
  return {
    prefix: row.source.prefix,
    fragment: row.text.slice(row.source.prefix.length),
    relativeStartOffset: overlap.from - row.source.startOffset,
    relativeEndOffset: overlap.to - row.source.startOffset,
  };
};

const getRowSourceOverlap = (
  bounds: SourceSelectionBounds,
  indexOf: (sourceId: string) => number,
  source: TranscriptRowSource,
): OffsetRange | null => {
  const unitIndex = indexOf(source.sourceId);
  if (unitIndex < 0) return null;
  const unitRange = getUnitSelectionRange(bounds, unitIndex);
  if (!unitRange) return null;
  const from = Math.max(source.startOffset, unitRange.from);
  const to = Math.min(source.endOffset, unitRange.to);
  return from >= to ? null : { from, to };
};

/** 装饰前缀不映射源文本，cell 坐标会从内容区开始折算为 offset。 */
export const getSourcePointAtCell = (
  row: TranscriptRow,
  cell: number,
): TranscriptSelectionPoint | null => {
  if (!row.source) return null;
  const fragment = row.text.slice(row.source.prefix.length);
  const prefixCells = stringWidth(row.source.prefix);
  const relativeCell = Math.max(0, cell - prefixCells);
  return {
    sourceId: row.source.sourceId,
    offset: row.source.startOffset + offsetOfCell(fragment, relativeCell),
  };
};

export const splitRowPartsBySelection = (
  row: TranscriptRow,
  range: RowSelectionRange,
): RowSelectionPart[] => {
  if (row.segments && row.text) {
    return splitSegmentsBySelection(row.segments, range);
  }
  return splitRowBySelection(row.text || " ", range).map(withRowStyle(row));
};

export const splitSegmentsBySelection = (
  segments: readonly TranscriptRowSegment[],
  range: RowSelectionRange,
): RowSelectionPart[] => {
  const parts: RowSelectionPart[] = [];
  let column = 0;
  for (const segment of segments) {
    parts.push(...splitSegmentBySelection(segment, range, column));
    column += stringWidth(segment.text);
  }
  return parts;
};

const splitSegmentBySelection = (
  segment: TranscriptRowSegment,
  range: RowSelectionRange,
  column: number,
): RowSelectionPart[] => {
  const localRange = {
    fromCol: Math.max(0, range.fromCol - column),
    toCol: Math.min(range.toCol - column, stringWidth(segment.text)),
  };
  return splitRowBySelection(segment.text, localRange)
    .filter((part) => part.text || part.selected)
    .map((part) => ({
      ...part,
      color: segment.color,
      bold: segment.bold,
      dimColor: segment.dimColor,
    }));
};

/** 宽字符跨过选择边界时，整枚字素归入选中段。 */
export const splitRowBySelection = (
  text: string,
  range: RowSelectionRange,
): RowSelectionPart[] => {
  const parts: RowSelectionPart[] = [];
  let column = 0;
  let current: RowSelectionPart | null = null;
  for (const cluster of splitGraphemes(text)) {
    const width = Math.max(1, stringWidth(cluster));
    const selected = column + width > range.fromCol && column < range.toCol;
    if (current && current.selected === selected) {
      current.text += cluster;
    } else {
      current = { text: cluster, selected };
      parts.push(current);
    }
    column += width;
  }
  return parts.length > 0 ? parts : [{ text, selected: false }];
};

const withRowStyle = (row: TranscriptRow) => (part: RowSelectionPart): RowSelectionPart => ({
  ...part,
  color: row.color,
  bold: row.bold,
  dimColor: row.dimColor,
});

const isPointFirst = (
  a: { index: number; offset: number },
  b: { index: number; offset: number },
): boolean => a.index < b.index || (a.index === b.index && a.offset <= b.offset);

// 点击装饰行或输入框不产生选中。
const toStartPoint = (
  event: TranscriptSelectEvent,
  visibleRows: readonly TranscriptRow[],
): TranscriptSelectionPoint | null => {
  const rowIndex = event.row - 1;
  if (rowIndex < 0 || rowIndex >= visibleRows.length) return null;
  return getSourcePointAtCell(visibleRows[rowIndex], Math.max(0, event.col - 1));
};

const toClampedPoint = (
  event: TranscriptSelectEvent,
  visibleRows: readonly TranscriptRow[],
): TranscriptSelectionPoint | null => {
  const rowCount = visibleRows.length;
  if (rowCount === 0) return null;
  const rowIndex = Math.min(Math.max(0, event.row - 1), rowCount - 1);
  return getSourcePointAtCell(visibleRows[rowIndex], Math.max(0, event.col - 1));
};

// 松开坐标也更新 active，用来兼容未上报拖拽移动事件的终端。
const getEndSelection = (
  event: TranscriptSelectEvent,
  selection: TranscriptSelection | null,
  visibleRows: readonly TranscriptRow[],
): TranscriptSelection | null => {
  if (!selection) return null;
  const point = toClampedPoint(event, visibleRows);
  return point ? extendTranscriptSelection(selection, point) : selection;
};

const finishTranscriptSelection = (
  selection: TranscriptSelection | null,
  sources: readonly TranscriptSourceUnit[],
): TranscriptSelectionReduceResult => {
  if (!selection) return { selection: null, copyText: null };
  const bounds = resolveSelectionBounds(selection, createSourceIndexLookup(sources));
  if (!bounds || isDegenerateSelection(bounds)) {
    return { selection: null, copyText: null };
  }
  return { selection: null, copyText: buildSelectedText(sources, selection) };
};

const measureColumnRange = (
  text: string,
  startOffset: number,
  endOffset: number,
): [number, number] => {
  let column = 0;
  let offset = 0;
  let startColumn = -1;
  let endColumn = -1;
  for (const cluster of splitGraphemes(text)) {
    if (startColumn < 0 && offset >= startOffset) startColumn = column;
    if (endColumn < 0 && offset >= endOffset) endColumn = column;
    column += Math.max(1, stringWidth(cluster));
    offset += cluster.length;
  }
  return [startColumn < 0 ? column : startColumn, endColumn < 0 ? column : endColumn];
};

const offsetOfCell = (text: string, cell: number): number => {
  let column = 0;
  let offset = 0;
  for (const cluster of splitGraphemes(text)) {
    const width = Math.max(1, stringWidth(cluster));
    if (column + width > cell) return offset;
    column += width;
    offset += cluster.length;
  }
  return offset;
};
