import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { AssistantTurn } from "../../assistantTurn.js";
import type { ChatEntry } from "../../hooks/index.js";
import {
  buildTranscriptRows,
  type TranscriptHeader,
  type TranscriptRow,
} from "../../transcriptRows.js";
import {
  createTranscriptScrollState,
  getMaxOffset,
  isPinnedToBottom,
  reconcileTranscriptScroll,
  scrollTranscript,
  selectVisibleTranscriptRows,
  type TranscriptScrollAction,
  type TranscriptScrollState,
} from "../../transcriptScroll.js";

const MAX_TRANSCRIPT_ROWS = 2000;
const MIN_VIEWPORT_HEIGHT = 1;

interface UseTranscriptViewportControllerOptions {
  header?: TranscriptHeader;
  entries: readonly ChatEntry[];
  streamingReasoning: string;
  streamingAssistantTurn: AssistantTurn | null;
  width: number;
  height: number;
}

interface TranscriptViewportController {
  height: number;
  visibleRows: readonly TranscriptRow[];
  showScrollHint: boolean;
  isPinnedToBottom: boolean;
  wheelRows: number;
  scroll: (action: TranscriptScrollAction) => void;
}

interface TranscriptViewportProps {
  height: number;
  visibleRows: readonly TranscriptRow[];
  showScrollHint: boolean;
}

interface TranscriptRowViewProps {
  row: TranscriptRow;
}

export const useTranscriptViewportController = ({
  header,
  entries,
  streamingReasoning,
  streamingAssistantTurn,
  width,
  height,
}: UseTranscriptViewportControllerOptions): TranscriptViewportController => {
  const viewportHeight = Math.max(MIN_VIEWPORT_HEIGHT, height);
  const rows = buildTranscriptRows({
    header,
    entries,
    streamingReasoning,
    streamingAssistantTurn,
    width,
  });
  const historyAnchor = entries[0]?.id ?? "empty";
  const [scrollState, setScrollState] = useState<TranscriptScrollState>(
    createTranscriptScrollState(rows.length),
  );
  const renderState = getRenderScrollState({ state: scrollState, totalRows: rows.length, viewportHeight });
  const pinnedToBottom = isPinnedToBottom(renderState);
  const showScrollHint = !pinnedToBottom;
  const bodyHeight = getBodyHeight(viewportHeight, pinnedToBottom);
  const visibleRows = selectVisibleTranscriptRows(rows, renderState, bodyHeight);
  const wheelRows = Math.max(3, Math.floor(bodyHeight / 3));

  useEffect(() => {
    setScrollState((current) => {
      const next = getRenderScrollState({ state: current, totalRows: rows.length, viewportHeight });
      return isSameScrollState(current, next) ? current : next;
    });
  }, [rows.length, viewportHeight]);

  useEffect(() => {
    setScrollState(createTranscriptScrollState(rows.length));
  }, [historyAnchor]);

  const scroll = (action: TranscriptScrollAction) => {
    setScrollState((current) =>
      scrollTranscript(current, action, bodyHeight),
    );
  };

  return {
    height: viewportHeight,
    visibleRows,
    showScrollHint,
    isPinnedToBottom: pinnedToBottom,
    wheelRows,
    scroll,
  };
};

const getRenderScrollState = ({
  state,
  totalRows,
  viewportHeight,
}: {
  state: TranscriptScrollState;
  totalRows: number;
  viewportHeight: number;
}): TranscriptScrollState => {
  const preliminaryBodyHeight = getBodyHeight(viewportHeight, isPinnedToBottom(state));
  const preliminary = reconcileLimitedScroll(state, totalRows, preliminaryBodyHeight);
  const pinnedToBottom = isPinnedToBottom(preliminary);
  const bodyHeight = getBodyHeight(viewportHeight, pinnedToBottom);

  return reconcileLimitedScroll(state, totalRows, bodyHeight);
};

const reconcileLimitedScroll = (
  state: TranscriptScrollState,
  totalRows: number,
  viewportRows: number,
): TranscriptScrollState =>
  limitScrollHistory(
    reconcileTranscriptScroll(state, totalRows, viewportRows),
    viewportRows,
  );

const limitScrollHistory = (
  state: TranscriptScrollState,
  viewportRows: number,
): TranscriptScrollState => {
  const maxOffset = Math.min(
    getMaxOffset(state.totalRows, viewportRows),
    getMaxOffset(MAX_TRANSCRIPT_ROWS, viewportRows),
  );
  return {
    ...state,
    offsetFromBottom: Math.min(state.offsetFromBottom, maxOffset),
  };
};

const getBodyHeight = (viewportHeight: number, pinnedToBottom: boolean): number =>
  Math.max(0, viewportHeight - (pinnedToBottom ? 0 : 1));

const isSameScrollState = (
  current: TranscriptScrollState,
  next: TranscriptScrollState,
): boolean =>
  current.offsetFromBottom === next.offsetFromBottom &&
  current.totalRows === next.totalRows;

const TranscriptViewport = ({
  height,
  visibleRows,
  showScrollHint,
}: TranscriptViewportProps) => {
  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {visibleRows.map((row) => (
        <TranscriptRowView key={row.id} row={row} />
      ))}
      {showScrollHint && (
        <Text color="gray" dimColor>
          End 回到底部 / 有新内容
        </Text>
      )}
    </Box>
  );
};

const TranscriptRowView = ({ row }: TranscriptRowViewProps) => (
  <Text
    color={row.color}
    backgroundColor={row.backgroundColor}
    bold={row.bold}
    dimColor={row.dimColor}
  >
    {row.segments && row.text
      ? row.segments.map((segment, index) => (
          <Text
            key={`${row.id}_segment_${index}`}
            color={segment.color}
            bold={segment.bold}
            dimColor={segment.dimColor}
          >
            {segment.text}
          </Text>
        ))
      : row.text || " "}
  </Text>
);

export default TranscriptViewport;
export type { TranscriptRow };
