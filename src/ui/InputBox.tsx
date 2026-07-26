import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";

interface Props {
  onSubmit: (text: string) => void;
  disabled: boolean;
}

const InputBox: React.FC<Props> = ({ onSubmit, disabled }) => {
  const [input, setInput] = useState("");

  useInput(
    useCallback(
      (inputChar: string, key: { return: boolean; backspace: boolean; delete: boolean }) => {
        if (disabled) return;

        if (key.return) {
          const trimmed = input.trim();
          if (trimmed) {
            onSubmit(trimmed);
            setInput("");
          }
        } else if (key.backspace || key.delete) {
          setInput((prev) => prev.slice(0, -1));
        } else {
          // 过滤控制字符
          if (inputChar && inputChar.length === 1 && inputChar.charCodeAt(0) >= 32) {
            setInput((prev) => prev + inputChar);
          }
        }
      },
      [input, disabled, onSubmit]
    )
  );

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box>
        <Text color="green" bold>
          ▸{" "}
        </Text>
        <Text color={disabled ? "gray" : "white"}>
          {input}
        </Text>
        {!disabled && (
          <Text color="gray">|</Text>
        )}
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
