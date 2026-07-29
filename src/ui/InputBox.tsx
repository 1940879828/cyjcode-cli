import { useState, useLayoutEffect, useRef } from "react";
import { Box, Text } from "ink";
import { useStdin } from "ink";

// ─── 括号粘贴标记 ──────────────────────────────────

const PASTE_START = "\u001B[200~";
const PASTE_END = "\u001B[201~";

interface Props {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

const InputBox = ({ onSubmit, disabled }: Props) => {
  const [value, setValue] = useState("");
  const { stdin, setRawMode } = useStdin();

  // ref 避免 stdin 事件闭包捕获过期值
  const valueRef = useRef(value);
  valueRef.current = value;
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  // 多 chunk 粘贴缓冲
  const pasteRef = useRef({ active: false, chunks: [] as string[] });

  /** 处理解析后的输入字符串 */
  const processInput = (raw: string): void => {
    if (raw.includes("\r")) {
      const current = valueRef.current.trim();
      if (current) {
        submitRef.current(current);
        setValue("");
      }
      // 去掉 \r，继续处理 \r 之后的内容
      raw = raw.replace(/\r/g, "");
    }

    // 过滤控制字符（\x00-\x1F 除 \x08、\x7F 为退格），\x7F 单独处理
    const backspaces = (raw.match(/[\b\x7F]/g) ?? []).length;
    const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    if (backspaces > 0) {
      setValue((prev) => prev.slice(0, Math.max(0, prev.length - backspaces)));
    }
    if (clean.length > 0) {
      setValue((prev) => prev + clean);
    }
  };

  useLayoutEffect(() => {
    if (!stdin || disabled) return;

    setRawMode(true);
    process.stdout.write("\u001B[?2004h"); // 启用括号粘贴

    const handleData = (data: Buffer) => {
      const raw = String(data);

      // ── 括号粘贴处理 ──
      if (raw.includes(PASTE_START)) {
        pasteRef.current.active = true;
        pasteRef.current.chunks = [];
        const afterStart = raw.slice(
          raw.indexOf(PASTE_START) + PASTE_START.length,
        );
        const endIdx = afterStart.indexOf(PASTE_END);
        if (endIdx !== -1) {
          // 起止标记在同一 chunk
          pasteRef.current.active = false;
          const pasteContent = afterStart.slice(0, endIdx);
          const remaining = afterStart.slice(endIdx + PASTE_END.length);
          if (pasteContent) setValue((prev) => prev + pasteContent);
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
          if (pasteContent) setValue((prev) => prev + pasteContent);
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

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box>
        <Text color="green" bold>
          ▸{" "}
        </Text>
        <Text color={disabled ? "gray" : "white"}>{value}</Text>
        {!disabled && <Text color="gray">|</Text>}
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
