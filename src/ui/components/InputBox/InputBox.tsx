import { useRef, useState } from "react";
import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import type { Key } from "ink";
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
  InputBoxState,
} from "./inputBoxModel.js";

// 输入框提示符
const PROMPT = "❯ ";
// 输入框提示符的宽度（以"column"为单位）
const PROMPT_WIDTH = stringWidth(PROMPT);

interface Props {
  // 提交回调 上层拿到这段文本去发起 AI 请求
  onSubmit: (text: string) => void;
  // 为 true 时输入框不可输入
  disabled: boolean;
  // true 表示 App 正在退出 : isActive 变 false 隐藏光标
  isExiting?: boolean;
}

// 副作用 handler
interface InputBoxEffectHandlers {
  onSubmit: (text: string) => void;
}

// 获取当前终端的宽度（以"列数"为单位），取不到则返回 null
const getScreenWidth = (columns: number | undefined): number | null =>
  columns ?? process.stdout.columns ?? null;

// 输入框实际可用的宽度（列数）
const getInputColumns = (screenWidth: number): number =>
  Math.max(1, screenWidth - PROMPT_WIDTH - 1);

const runInputBoxEffect = (
  effect: InputBoxEffect,
  handlers: InputBoxEffectHandlers,
) => {
  if (effect.type === "submit") handlers.onSubmit(effect.text);
};

const InputBox = ({ onSubmit, disabled, isExiting = false }: Props) => {
  const [inputState, setInputState] = useState<InputBoxState>(() =>
    createInputBoxState(),
  );
  const onSubmitRef = useRef(onSubmit);
  const { columns } = useWindowSize();

  onSubmitRef.current = onSubmit;

  const screenWidth = getScreenWidth(columns);
  // 取不到宽度 后续的输入框没有意义
  if (screenWidth === null) return null;

  const inputColumns = getInputColumns(screenWidth);
  const layout = { inputColumns };
  const isActive = !disabled && !isExiting;
  // 反色字符渲染：光标以反色字符内嵌进文本，由 Ink 的 diff 机制移动
  const view = selectInputBoxView(inputState, layout, isActive);

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
        borderTop={true}
        borderBottom={true}
        borderLeft={false}
        borderRight={false}
        borderDimColor
      >
        <Text bold color="#cccccc">
          {PROMPT}
        </Text>
        <Box width={inputColumns} flexShrink={1}>
          <Text color={inputColor}>{renderedText}</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default InputBox;
