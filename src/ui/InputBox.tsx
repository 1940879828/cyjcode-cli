import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  Box,
  Text,
  measureElement,
  useCursor,
  useInput,
  usePaste,
  useWindowSize,
} from "ink";
import type { CursorPosition, DOMElement, Key } from "ink";
import stringWidth from "string-width";
import {
  createInputBoxState,
  reduceInputBoxState,
  resolveInputBoxEvent,
  selectInputBoxView,
} from "./inputBoxModel.js";
import type {
  InputBoxEffect,
  InputBoxEvent,
  InputBoxView,
  InputBoxState,
} from "./inputBoxModel.js";

const PROMPT = "❯ ";
const PROMPT_WIDTH = stringWidth(PROMPT);
const FALLBACK_SCREEN_WIDTH = 80;

interface Props {
  onSubmit: (text: string) => void;
  disabled: boolean;
  isExiting?: boolean;
}

interface InputBoxEffectHandlers {
  onSubmit: (text: string) => void;
}

// 获取当前终端的宽度（以"列数"为单位）
const getScreenWidth = (columns: number | undefined): number =>
  columns ?? process.stdout.columns ?? FALLBACK_SCREEN_WIDTH;

// 输入框实际可用的宽度（列数）
const getInputColumns = (screenWidth: number): number =>
  Math.max(1, screenWidth - PROMPT_WIDTH - 1);

const getLayoutRoot = (node: DOMElement): DOMElement => {
  let current = node;
  while (current.parentNode) current = current.parentNode;
  return current;
};

const measureCursorOrigin = (node: DOMElement, rows: number): CursorPosition => {
  const metrics = measureElement(node);
  const rootMetrics = measureElement(getLayoutRoot(node));
  // Ink omits the trailing newline in fullscreen output, but useCursor still
  // positions from the post-output row. Nudge y only for that render path.
  const fullscreenOffset =
    process.stdout.isTTY && rootMetrics.height >= rows ? 1 : 0;
  return { x: metrics.x, y: metrics.y + fullscreenOffset };
};

const samePosition = (
  left: CursorPosition | null,
  right: CursorPosition,
): boolean => left?.x === right.x && left.y === right.y;

const runInputBoxEffect = (
  effect: InputBoxEffect,
  handlers: InputBoxEffectHandlers,
) => {
  if (effect.type === "submit") handlers.onSubmit(effect.text);
};

const useTerminalCursor = ({
  isActive,
  inputRef,
  position,
  rows,
}: {
  isActive: boolean;
  inputRef: RefObject<DOMElement | null>;
  position: InputBoxView["cursorPosition"];
  rows: number;
}) => {
  const [origin, setOrigin] = useState<CursorPosition | null>(null);
  const { setCursorPosition } = useCursor();

  useLayoutEffect(() => {
    if (!isActive || !inputRef.current) {
      setOrigin((previous) => (previous === null ? previous : null));
      return;
    }

    const next = measureCursorOrigin(inputRef.current, rows);
    setOrigin((previous) => (samePosition(previous, next) ? previous : next));
  });

  setCursorPosition(
    isActive && origin
      ? {
          x: origin.x + position.column,
          y: origin.y + position.line,
        }
      : undefined,
  );
};

const InputBox = ({ onSubmit, disabled, isExiting = false }: Props) => {
  const [inputState, setInputState] = useState<InputBoxState>(() =>
    createInputBoxState(),
  );
  const inputTextRef = useRef<DOMElement | null>(null);
  const onSubmitRef = useRef(onSubmit);
  const { columns, rows } = useWindowSize();

  onSubmitRef.current = onSubmit;

  const screenWidth = getScreenWidth(columns);
  const inputColumns = getInputColumns(screenWidth);
  const layout = { inputColumns };
  const isActive = !disabled && !isExiting;
  const view = selectInputBoxView(inputState, layout);

  useTerminalCursor({
    isActive,
    inputRef: inputTextRef,
    position: view.cursorPosition,
    rows,
  });

  const dispatchInputEvent = (event: InputBoxEvent) => {
    setInputState((previous) => {
      const next = reduceInputBoxState(previous, event, layout);
      if (next.state === previous && next.effects.length === 0) {
        return previous;
      }

      for (const effect of next.effects) {
        runInputBoxEffect(effect, { onSubmit: onSubmitRef.current });
      }

      return next.state;
    });
  };

  const handleInput = (input: string, key: Key) => {
    dispatchInputEvent(resolveInputBoxEvent(input, key));
  };

  useInput(handleInput, { isActive });
  usePaste((text) => dispatchInputEvent({ type: "insertText", text }), { isActive });

  const renderedText = view.renderedText || " ";
  const inputColor = disabled ? "#888888" : undefined;

  return (
    <Box flexDirection="column" paddingX={0} marginTop={1}>
      {disabled && (
        <Box>
          <Text color="gray" dimColor>
            等待回复中……
          </Text>
        </Box>
      )}
      <Box
        width={screenWidth - 1}
        borderStyle="single"
        borderTop={false}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderDimColor
      >
        <Text bold color="#cccccc">
          {PROMPT}
        </Text>
        <Box ref={inputTextRef} width={inputColumns} flexShrink={1}>
          <Text color={inputColor}>{renderedText}</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default InputBox;
