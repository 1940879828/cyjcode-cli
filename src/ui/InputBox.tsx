import { useState, useLayoutEffect, useRef, useCallback } from "react";
import { Box, Text, useStdin, useCursor, measureElement, useWindowSize } from "ink";
import type { CursorPosition } from "ink";

// ─── 光标移动 ANSI 序列 ──────────────────────────────

const LEFT = "\u001B[D";
const RIGHT = "\u001B[C";
const HOME_SEQ = new Set(["\u001B[H", "\u001B[1~", "\u001BOH"]);
const END_SEQ = new Set(["\u001B[F", "\u001B[4~", "\u001BOF"]);
const CTRL_LEFT = new Set(["\u001B[1;5D", "\u001B[5D"]);
const CTRL_RIGHT = new Set(["\u001B[1;5C", "\u001B[5C"]);
const DELETE_SEQ = new Set(["\u001B[3~", "\u001B[P"]);

// ─── 括号粘贴标记 ──────────────────────────────────

const PASTE_START = "\u001B[200~";
const PASTE_END = "\u001B[201~";

// ─── 状态类型 ──────────────────────────────────────

interface BufferState {
  text: string;
  cursor: number;
}

const clampCursor = (cursor: number, text: string): number =>
  Math.max(0, Math.min(cursor, text.length));

// ─── 纯函数：光标编辑操作 ────────────────────────────

const moveToWordBoundaryLeft = (text: string, cursor: number): number => {
  let pos = cursor;
  while (pos > 0 && /\s/.test(text[pos - 1]!)) pos--;
  while (pos > 0 && !/\s/.test(text[pos - 1]!)) pos--;
  return pos;
};

const moveToWordBoundaryRight = (text: string, cursor: number): number => {
  let pos = cursor;
  while (pos < text.length && /\s/.test(text[pos]!)) pos++;
  while (pos < text.length && !/\s/.test(text[pos]!)) pos++;
  return pos;
};

// ─── 组件 ──────────────────────────────────────────

interface Props {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

const InputBox = ({ onSubmit, disabled }: Props) => {
  const [state, setState] = useState<BufferState>({ text: "", cursor: 0 });
  const { stdin, setRawMode } = useStdin();
  const { setCursorPosition } = useCursor();
  const { columns } = useWindowSize();
  const inputLineRef = useRef<any>(null);

  const screenWidth = columns ?? process.stdout.columns ?? 80;

  // ref 避免 stdin 事件闭包捕获过期值
  const stateRef = useRef(state);
  stateRef.current = state;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  // 多 chunk 粘贴缓冲
  const pasteRef = useRef({ active: false, chunks: [] as string[] });

  // ── 终端原生光标（自带闪烁） ──
  // 模式同 deepcode：useLayoutEffect 测量 → setState，render 阶段调 setCursorPosition
  const [cursorOrigin, setCursorOrigin] = useState<CursorPosition | null>(null);

  useLayoutEffect(() => {
    if (disabled || !inputLineRef.current) {
      setCursorOrigin(null);
      return;
    }
    const metrics = measureElement(inputLineRef.current);
    if (metrics) {
      setCursorOrigin({ x: metrics.x, y: metrics.y });
    }
  }, [state.cursor, state.text, disabled]);

  if (!disabled && cursorOrigin) {
    setCursorPosition({ x: cursorOrigin.x + state.cursor, y: cursorOrigin.y });
  }

  // ── 光标控制函数 ──

  const moveLeft = useCallback(() => {
    setState((prev) => ({ ...prev, cursor: clampCursor(prev.cursor - 1, prev.text) }));
  }, []);

  const moveRight = useCallback(() => {
    setState((prev) => ({ ...prev, cursor: clampCursor(prev.cursor + 1, prev.text) }));
  }, []);

  const moveHome = useCallback(() => {
    setState((prev) => ({ ...prev, cursor: 0 }));
  }, []);

  const moveEnd = useCallback(() => {
    setState((prev) => ({ ...prev, cursor: prev.text.length }));
  }, []);

  const moveWordLeft = useCallback(() => {
    setState((prev) => ({
      ...prev,
      cursor: moveToWordBoundaryLeft(prev.text, prev.cursor),
    }));
  }, []);

  const moveWordRight = useCallback(() => {
    setState((prev) => ({
      ...prev,
      cursor: moveToWordBoundaryRight(prev.text, prev.cursor),
    }));
  }, []);

  const insertAtCursor = useCallback((input: string) => {
    setState((prev) => {
      const text =
        prev.text.slice(0, prev.cursor) + input + prev.text.slice(prev.cursor);
      return { text, cursor: prev.cursor + input.length };
    });
  }, []);

  const backspaceAtCursor = useCallback((count: number) => {
    setState((prev) => {
      const removeCount = Math.min(count, prev.cursor);
      const text =
        prev.text.slice(0, prev.cursor - removeCount) +
        prev.text.slice(prev.cursor);
      return { text, cursor: prev.cursor - removeCount };
    });
  }, []);

  const deleteAtCursor = useCallback(() => {
    setState((prev) => {
      if (prev.cursor >= prev.text.length) return prev;
      const text =
        prev.text.slice(0, prev.cursor) + prev.text.slice(prev.cursor + 1);
      return { text, cursor: prev.cursor };
    });
  }, []);

  const submit = useCallback(() => {
    const current = stateRef.current.text.trim();
    if (current) {
      submitRef.current(current);
      setState({ text: "", cursor: 0 });
    }
  }, []);

  // ── 转义序列分发 ──

  const handleEscapeSequence = useCallback(
    (raw: string) => {
      if (raw === LEFT) return moveLeft();
      if (raw === RIGHT) return moveRight();
      if (HOME_SEQ.has(raw)) return moveHome();
      if (END_SEQ.has(raw)) return moveEnd();
      if (CTRL_LEFT.has(raw)) return moveWordLeft();
      if (CTRL_RIGHT.has(raw)) return moveWordRight();
      if (DELETE_SEQ.has(raw)) return deleteAtCursor();
    },
    [moveLeft, moveRight, moveHome, moveEnd, moveWordLeft, moveWordRight, deleteAtCursor],
  );

  // ── 普通输入处理 ──

  const processInput = useCallback(
    (raw: string) => {
      // 回车 → 提交
      if (raw.includes("\r")) {
        submit();
        raw = raw.replace(/\r/g, "");
      }

      // 退格计数 + 清理控制字符
      const backspaces = (raw.match(/[\b\x7F]/g) ?? []).length;
      const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

      if (backspaces > 0) backspaceAtCursor(backspaces);
      if (clean.length > 0) insertAtCursor(clean);
    },
    [submit, backspaceAtCursor, insertAtCursor],
  );

  // ── 生命周期 ──

  useLayoutEffect(() => {
    if (!stdin || disabled) return;

    setRawMode(true);
    process.stdout.write("\u001B[?2004h"); // 启用括号粘贴

    const handleData = (data: Buffer) => {
      const raw = String(data);

      // ── 转义序列（方向键等） ──
      if (raw.startsWith("\u001B") && raw.length > 1) {
        handleEscapeSequence(raw);
        return;
      }

      // ── 括号粘贴处理 ──
      if (raw.includes(PASTE_START)) {
        pasteRef.current.active = true;
        pasteRef.current.chunks = [];
        const afterStart = raw.slice(
          raw.indexOf(PASTE_START) + PASTE_START.length,
        );
        const endIdx = afterStart.indexOf(PASTE_END);
        if (endIdx !== -1) {
          pasteRef.current.active = false;
          const pasteContent = afterStart.slice(0, endIdx);
          const remaining = afterStart.slice(endIdx + PASTE_END.length);
          if (pasteContent) insertAtCursor(pasteContent);
          if (remaining) processInput(remaining);
          return;
        }
        pasteRef.current.chunks.push(afterStart);
        return;
      }

      if (pasteRef.current.active) {
        pasteRef.current.chunks.push(raw);
        const combined = pasteRef.current.chunks.join("");
        const endIdx = combined.indexOf(PASTE_END);
        if (endIdx !== -1) {
          pasteRef.current.active = false;
          const pasteContent = combined.slice(0, endIdx);
          const remaining = combined.slice(endIdx + PASTE_END.length);
          pasteRef.current.chunks = [];
          if (pasteContent) insertAtCursor(pasteContent);
          if (remaining) processInput(remaining);
        }
        return;
      }

      // ── 普通输入 ──
      processInput(raw);
    };

    stdin.on("data", handleData);
    return () => {
      stdin.off("data", handleData);
      setRawMode(false);
      process.stdout.write("\u001B[?2004l");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin, disabled]);

  // ── 渲染 ──

  const { text } = state;

  return (
    <Box flexDirection="column" paddingX={0}>
      <Box
        width={screenWidth-1}
        borderStyle="single"
        borderTop={true}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderDimColor
      >
        <Text color="green" bold>▸ </Text>
        <Box ref={inputLineRef} flexGrow={1}>
          <Text color={disabled ? "gray" : undefined}>{text}</Text>
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
