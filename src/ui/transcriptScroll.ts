export interface TranscriptScrollState {
  offsetFromBottom: number;
  totalRows: number;
}

export type TranscriptScrollAction =
  | { type: "lineUp"; amount?: number }
  | { type: "lineDown"; amount?: number }
  | { type: "pageUp" }
  | { type: "pageDown" }
  | { type: "top" }
  | { type: "bottom" };

export const createTranscriptScrollState = (
  totalRows = 0,
): TranscriptScrollState => ({
  offsetFromBottom: 0,
  totalRows,
});

export const isPinnedToBottom = (state: TranscriptScrollState): boolean =>
  state.offsetFromBottom === 0;

export const reconcileTranscriptScroll = (
  state: TranscriptScrollState,
  totalRows: number,
  viewportRows: number,
): TranscriptScrollState => {
  const maxOffset = getMaxOffset(totalRows, viewportRows);
  const addedRows = Math.max(0, totalRows - state.totalRows);
  const nextOffset = isPinnedToBottom(state)
    ? 0
    : state.offsetFromBottom + addedRows;

  return {
    offsetFromBottom: clampOffset(nextOffset, maxOffset),
    totalRows,
  };
};

export const scrollTranscript = (
  state: TranscriptScrollState,
  action: TranscriptScrollAction,
  viewportRows: number,
): TranscriptScrollState => {
  const maxOffset = getMaxOffset(state.totalRows, viewportRows);
  const page = Math.max(1, viewportRows - 1);
  const nextOffset = getNextOffset(state.offsetFromBottom, action, page, maxOffset);

  return {
    ...state,
    offsetFromBottom: clampOffset(nextOffset, maxOffset),
  };
};

export const scrollTranscriptHalfPage = (
  state: TranscriptScrollState,
  direction: "up" | "down",
  viewportRows: number,
): TranscriptScrollState => {
  const amount = Math.max(1, Math.floor(viewportRows / 2));
  return scrollTranscript(
    state,
    direction === "up"
      ? { type: "lineUp", amount }
      : { type: "lineDown", amount },
    viewportRows,
  );
};

export function selectVisibleTranscriptRows<Row>(
  rows: readonly Row[],
  state: TranscriptScrollState,
  viewportRows: number,
): readonly Row[] {
  if (viewportRows <= 0) {
    return [];
  }

  const maxOffset = getMaxOffset(rows.length, viewportRows);
  const offsetFromBottom = clampOffset(state.offsetFromBottom, maxOffset);
  const start = Math.max(0, rows.length - viewportRows - offsetFromBottom);
  return rows.slice(start, start + viewportRows);
}

export const getMaxOffset = (totalRows: number, viewportRows: number): number =>
  Math.max(0, totalRows - Math.max(1, viewportRows));

const clampOffset = (offset: number, maxOffset: number): number =>
  Math.min(Math.max(0, offset), maxOffset);

const getNextOffset = (
  offsetFromBottom: number,
  action: TranscriptScrollAction,
  page: number,
  maxOffset: number,
): number => {
  switch (action.type) {
    case "lineUp":
      return offsetFromBottom + (action.amount ?? 1);
    case "lineDown":
      return offsetFromBottom - (action.amount ?? 1);
    case "pageUp":
      return offsetFromBottom + page;
    case "pageDown":
      return offsetFromBottom - page;
    case "top":
      return maxOffset;
    case "bottom":
      return 0;
  }
};
