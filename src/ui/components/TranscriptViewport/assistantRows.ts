import stringWidth from "string-width";
import type { AssistantTurn, AssistantTurnPartKind } from "../../assistantTurn.js";
import {
  ASSISTANT_PREFIX,
  CONTINUATION_PREFIX,
  MIN_WRAP_WIDTH,
  ROLE_STYLES,
  createSpacerRow,
} from "./transcriptTheme.js";
import type { TranscriptRow, TranscriptRowKind, WrappedLine } from "./transcriptTypes.js";
import { wrapTextWithContinuation } from "./wrapByColumns.js";

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

type AssistantBlockKind = "text" | "tool";

export const buildAssistantTurnRows = (
  turn: AssistantTurn,
  width: number,
): TranscriptRow[] => {
  const rows: TranscriptRow[] = [];
  appendAssistantTurnRows(rows, turn, width);
  return rows;
};

export const appendAssistantTurnRows = (
  rows: TranscriptRow[],
  turn: AssistantTurn,
  width: number,
) => {
  const previousBlock = appendAssistantPartBlocks(rows, turn, width);
  appendActiveAssistantBlock({ rows, turn, width, previousBlock });
  rows.push(createSpacerRow(`${turn.id}_after`));
};

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
    input.rows.push(createSpacerRow(`${input.turnId}_block_${input.index}_before`));
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

export const appendWrappedRows = (
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
