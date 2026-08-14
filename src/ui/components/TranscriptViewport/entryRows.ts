import type { AssistantTurn } from "../../assistantTurn.js";
import type { ChatEntry, TextChatEntry } from "../../hooks/index.js";
import { appendAssistantTurnRows } from "./assistantRows.js";
import {
  CONTINUATION_PREFIX,
  ROLE_STYLES,
  USER_PREFIX,
  createSpacerRow,
} from "./transcriptTheme.js";
import type { TranscriptRow, TranscriptRowKind } from "./transcriptTypes.js";
import { appendWrappedRows } from "./assistantRows.js";

interface ThinkingRowsInput {
  rows: TranscriptRow[];
  id: string;
  content: string;
  width: number;
}

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

export const buildTranscriptStreamingRows = ({
  streamingReasoning,
  streamingAssistantTurn,
  width,
}: {
  streamingReasoning: string;
  streamingAssistantTurn: AssistantTurn | null;
  width: number;
}): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];
  appendStreamingRows(rows, { streamingReasoning, streamingAssistantTurn, width });
  return rows;
};

const appendStreamingRows = (
  rows: TranscriptRow[],
  input: {
    streamingReasoning: string;
    streamingAssistantTurn: AssistantTurn | null;
    width: number;
  },
) => {
  appendStreamingReasoning(rows, input.streamingReasoning, input.width);
  appendStreamingAssistant(rows, input.streamingAssistantTurn, input.width);
};

const appendStreamingReasoning = (
  rows: TranscriptRow[],
  streamingReasoning: string,
  width: number,
) => {
  if (!streamingReasoning) return;
  appendThinkingRows({
    rows,
    id: "streaming_reasoning",
    content: streamingReasoning,
    width,
  });
};

const appendStreamingAssistant = (
  rows: TranscriptRow[],
  streamingAssistantTurn: AssistantTurn | null,
  width: number,
) => {
  if (streamingAssistantTurn) appendAssistantTurnRows(rows, streamingAssistantTurn, width);
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
  if (shouldAppendBlockSpacer(input.entry)) rows.push(createSpacerRow(`${input.entry.id}_after`));
};

const shouldAppendBlockSpacer = (entry: TextChatEntry): boolean =>
  entry.role === "system" || entry.role === "user";

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
  appendWrappedRows(input.rows, {
    id: input.id,
    kind: "thinking",
    content: input.content,
    width: input.width,
    firstPrefix: "Thinking: ",
    restPrefix: CONTINUATION_PREFIX,
  });
  input.rows.push(createSpacerRow(`${input.id}_after`));
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
  });
};

export const getTranscriptRowStyle = (kind: TranscriptRowKind) => ROLE_STYLES[kind];
