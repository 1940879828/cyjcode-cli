import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
import { TextCursor } from "./textEditor.js";

const PROMPT = "❯ ";
const PROMPT_WIDTH = stringWidth(PROMPT);

interface BufferState {
  text: string;
  cursor: number;
}

interface Props {
  onSubmit: (text: string) => void;
  disabled: boolean;
  isExiting?: boolean;
}

type EditorAction = (cursor: TextCursor) => TextCursor;

const normalizeInput = (input: string): string =>
  input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const getLayoutRoot = (node: DOMElement): DOMElement => {
  let current = node;
  while (current.parentNode) current = current.parentNode;
  return current;
};

const InputBox = ({ onSubmit, disabled, isExiting = false }: Props) => {
  const [state, setState] = useState<BufferState>({ text: "", cursor: 0 });
  const [cursorOrigin, setCursorOrigin] = useState<CursorPosition | null>(null);
  const inputTextRef = useRef<DOMElement | null>(null);
  const { setCursorPosition } = useCursor();
  const { columns, rows } = useWindowSize();

  const screenWidth = columns ?? process.stdout.columns ?? 80;
  const inputColumns = Math.max(1, screenWidth - PROMPT_WIDTH - 1);
  const isActive = !disabled && !isExiting;
  const editor = TextCursor.fromText(state.text, inputColumns, state.cursor);
  const cursorPosition = editor.getPosition();

  const stateRef = useRef(state);
  stateRef.current = state;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  useLayoutEffect(() => {
    if (!isActive || !inputTextRef.current) {
      setCursorOrigin((previous) => (previous === null ? previous : null));
      return;
    }

    const metrics = measureElement(inputTextRef.current);
    const rootMetrics = measureElement(getLayoutRoot(inputTextRef.current));
    // Ink omits the trailing newline in fullscreen output, but useCursor still
    // positions from the post-output row. Nudge y only for that render path.
    const fullscreenOffset =
      process.stdout.isTTY && rootMetrics.height >= rows ? 1 : 0;
    const next = { x: metrics.x, y: metrics.y + fullscreenOffset };
    setCursorOrigin((previous) =>
      previous?.x === next.x && previous.y === next.y ? previous : next,
    );
  });

  setCursorPosition(
    isActive && cursorOrigin
      ? {
          x: cursorOrigin.x + cursorPosition.column,
          y: cursorOrigin.y + cursorPosition.line,
        }
      : undefined,
  );

  const updateFromEditor = useCallback(
    (action: EditorAction) => {
      setState((previous) => {
        const current = TextCursor.fromText(
          previous.text,
          inputColumns,
          previous.cursor,
        );
        const next = action(current);
        return { text: next.text, cursor: next.offset };
      });
    },
    [inputColumns],
  );

  const insertText = useCallback(
    (input: string) => {
      if (input.length === 0) return;
      updateFromEditor((cursor) => cursor.insert(normalizeInput(input)));
    },
    [updateFromEditor],
  );

  const submit = useCallback(() => {
    const current = stateRef.current.text.trim();
    if (!current) return;

    submitRef.current(current);
    setState({ text: "", cursor: 0 });
  }, []);

  const handleCtrl = useCallback(
    (input: string) => {
      const actions: Record<string, EditorAction> = {
        a: (cursor) => cursor.startOfLine(),
        b: (cursor) => cursor.left(),
        d: (cursor) => cursor.deleteForward(),
        e: (cursor) => cursor.endOfLine(),
        f: (cursor) => cursor.right(),
        h: (cursor) => cursor.backspace(),
        k: (cursor) => cursor.deleteToLineEnd(),
        u: (cursor) => cursor.deleteToLineStart(),
        w: (cursor) => cursor.deleteWordBefore(),
      };
      const action = actions[input.toLowerCase()];
      if (action) updateFromEditor(action);
    },
    [updateFromEditor],
  );

  const handleMeta = useCallback(
    (input: string) => {
      const actions: Record<string, EditorAction> = {
        b: (cursor) => cursor.prevWord(),
        d: (cursor) => cursor.deleteWordAfter(),
        f: (cursor) => cursor.nextWord(),
      };
      const action = actions[input.toLowerCase()];
      if (action) updateFromEditor(action);
    },
    [updateFromEditor],
  );

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (key.return) {
        if (key.shift || key.meta) insertText("\n");
        else submit();
        return;
      }

      if (key.backspace) {
        updateFromEditor((cursor) =>
          key.ctrl || key.meta ? cursor.deleteWordBefore() : cursor.backspace(),
        );
        return;
      }

      if (key.delete) {
        updateFromEditor((cursor) =>
          key.meta ? cursor.deleteToLineEnd() : cursor.deleteForward(),
        );
        return;
      }

      if (key.home) return updateFromEditor((cursor) => cursor.startOfLine());
      if (key.end) return updateFromEditor((cursor) => cursor.endOfLine());
      if (key.upArrow) return updateFromEditor((cursor) => cursor.up());
      if (key.downArrow) return updateFromEditor((cursor) => cursor.down());
      if (key.leftArrow) {
        return updateFromEditor((cursor) =>
          key.ctrl || key.meta ? cursor.prevWord() : cursor.left(),
        );
      }
      if (key.rightArrow) {
        return updateFromEditor((cursor) =>
          key.ctrl || key.meta ? cursor.nextWord() : cursor.right(),
        );
      }

      if (key.ctrl) return handleCtrl(input);
      if (key.meta) return handleMeta(input);
      if (input.length > 0) insertText(input);
    },
    [handleCtrl, handleMeta, insertText, submit, updateFromEditor],
  );

  useInput(handleInput, { isActive });
  usePaste(insertText, { isActive });

  const renderedText = editor.getRenderedText();

  return (
    <Box flexDirection="column" paddingX={0} marginTop={1}>
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
          <Text color={disabled ? "#888888" : undefined}>
            {renderedText || " "}
          </Text>
        </Box>
      </Box>
      {disabled && (
        <Box>
          <Text color="gray" dimColor>
            等待回复中……
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default InputBox;
