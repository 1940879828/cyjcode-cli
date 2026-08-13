import { Box, Text } from "ink";
import stringWidth from "string-width";
import LoadingStatus from "../LoadingStatus/LoadingStatus.js";
import type { InputBoxView } from "./inputBoxModel.js";

const PROMPT = "❯ ";
const PROMPT_WIDTH = stringWidth(PROMPT);
const MIN_VISIBLE_INPUT_LINES = 4;
const MAX_VISIBLE_INPUT_LINES = 16;
const VISIBLE_INPUT_HEIGHT_RATIO = 0.35;

interface Props {
  view: InputBoxView;
  screenWidth: number;
  inputColumns: number;
  maxVisibleLines: number;
  disabled: boolean;
  statusMessage?: string | null;
  isExiting?: boolean;
}

export const getInputColumns = (screenWidth: number): number =>
  Math.max(1, screenWidth - PROMPT_WIDTH - 1);

export const getMaxVisibleInputLines = (screenHeight: number): number =>
  clamp(
    Math.floor(screenHeight * VISIBLE_INPUT_HEIGHT_RATIO),
    MIN_VISIBLE_INPUT_LINES,
    MAX_VISIBLE_INPUT_LINES,
  );

const InputBox = ({
  view,
  screenWidth,
  inputColumns,
  maxVisibleLines,
  disabled,
  statusMessage,
  isExiting = false,
}: Props) => {
  const isDimmed = disabled || isExiting;
  const renderedText = view.renderedText || " ";
  const renderedLines = renderedText.split("\n");
  const visibleLineStart = getVisibleLineStart(
    renderedLines.length,
    view.cursorVisualLine,
    maxVisibleLines,
  );
  const visibleText = renderedLines
    .slice(visibleLineStart, visibleLineStart + maxVisibleLines)
    .join("\n") || " ";
  const inputHeight = Math.min(maxVisibleLines, renderedLines.length);

  return (
    <Box flexDirection="column" paddingX={0} marginTop={1}>
      <Box height={1}>
        {disabled || statusMessage ? (
          <LoadingStatus message={statusMessage ?? undefined} />
        ) : (
          <Text> </Text>
        )}
      </Box>
      <Box
        width={screenWidth - 1}
        borderStyle="single"
        borderColor={isDimmed ? "gray" : undefined}
        borderTop={true}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderDimColor={isDimmed}
      >
        <Text bold color={isDimmed ? "gray" : "#cccccc"} dimColor={isDimmed}>
          {PROMPT}
        </Text>
        <Box width={inputColumns} height={inputHeight} flexShrink={1} overflow="hidden">
          <Text
            color={isDimmed ? "gray" : undefined}
            dimColor={isDimmed}
            wrap="truncate-end"
          >
            {visibleText}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

const getVisibleLineStart = (
  lineCount: number,
  cursorVisualLine: number,
  maxVisibleLines: number,
): number => {
  if (lineCount <= maxVisibleLines) {
    return 0;
  }

  const lastStart = lineCount - maxVisibleLines;
  return Math.min(Math.max(0, cursorVisualLine - maxVisibleLines + 1), lastStart);
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export default InputBox;
