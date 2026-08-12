import { Box, Text } from "ink";
import stringWidth from "string-width";
import LoadingStatus from "../LoadingStatus/LoadingStatus.js";
import type { InputBoxView } from "./inputBoxModel.js";

// 输入框提示符
const PROMPT = "❯ ";
// 输入框提示符的宽度（以"column"为单位）
const PROMPT_WIDTH = stringWidth(PROMPT);

interface Props {
  view: InputBoxView;
  screenWidth: number;
  inputColumns: number;
  maxVisibleLines: number;
  // 为 true 时输入框不可输入
  disabled: boolean;
  // true 表示 App 正在退出 : isActive 变 false 隐藏光标
  isExiting?: boolean;
}

// 输入框实际可用的宽度（列数）
export const getInputColumns = (screenWidth: number): number =>
  Math.max(1, screenWidth - PROMPT_WIDTH - 1);

export const getMaxVisibleInputLines = (screenHeight: number): number =>
  Math.max(4, Math.floor(screenHeight * 0.5));

const InputBox = ({
  view,
  screenWidth,
  inputColumns,
  maxVisibleLines,
  disabled,
  isExiting = false,
}: Props) => {
  const isDimmed = disabled || isExiting;
  const renderedText = view.renderedText || " ";
  const renderedLines = renderedText.split("\n");
  const visibleLineStart = getVisibleLineStart(
    renderedLines.length,
    view.cursorLine,
    maxVisibleLines,
  );
  const visibleText = renderedLines
    .slice(visibleLineStart, visibleLineStart + maxVisibleLines)
    .join("\n") || " ";
  const inputHeight = Math.min(maxVisibleLines, renderedLines.length);

  return (
    <Box flexDirection="column" paddingX={0} marginTop={1}>
      <Box height={1}>
        {disabled ? <LoadingStatus /> : <Text> </Text>}
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
          <Text color={isDimmed ? "gray" : undefined} dimColor={isDimmed}>
            {visibleText}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

const getVisibleLineStart = (
  lineCount: number,
  cursorLine: number,
  maxVisibleLines: number,
): number => {
  if (lineCount <= maxVisibleLines) {
    return 0;
  }

  const lastStart = lineCount - maxVisibleLines;
  return Math.min(Math.max(0, cursorLine - maxVisibleLines + 1), lastStart);
};

export default InputBox;
