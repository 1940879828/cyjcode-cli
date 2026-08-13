import { buildTranscriptHeaderRows } from "./headerRows.js";
import {
  buildTranscriptEntryRows,
  buildTranscriptStreamingRows,
} from "./entryRows.js";
import { buildTranscriptSources } from "./transcriptSources.js";
import type { BuildTranscriptRowsInput, TranscriptRow } from "./transcriptTypes.js";

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

export {
  buildTranscriptHeaderRows,
  buildTranscriptEntryRows,
  buildTranscriptStreamingRows,
  buildTranscriptSources,
};

export {
  wrapTextByColumns,
  splitGraphemes,
} from "./wrapByColumns.js";

export type {
  BuildTranscriptRowsInput,
  TranscriptHeader,
  TranscriptRow,
  TranscriptRowKind,
  TranscriptRowSegment,
  TranscriptRowSource,
  TranscriptSourceUnit,
  WrappedLine,
} from "./transcriptTypes.js";
