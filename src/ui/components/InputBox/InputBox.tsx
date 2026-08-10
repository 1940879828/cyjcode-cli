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

/**
 * 副作用执行器：将 reducer 产出的副作用描述兑现为真实操作
 * - （纯函数核心不碰 I/O，副作用统一在此消费）
 * @param effect
 * @param handlers
 */
const runInputBoxEffect = (
  effect: InputBoxEffect,
  handlers: InputBoxEffectHandlers,
) => {
  // 提交输入框内容，交由上层发起 AI 请求
  if (effect.type === "submit") handlers.onSubmit(effect.text);
};

const InputBox = ({ onSubmit, disabled, isExiting = false }: Props) => {
  /**
   * 输入框核心状态（唯一事实来源）：仅含文本编辑态；
   * - 宽度/回调/禁用态等外围状态不在此状态机内，分别走 layout 参数、ref、Props
   */
  const [inputState, setInputState] = useState<InputBoxState>(() =>
    createInputBoxState(),
  );
  /**
   * 缓存最新的 onSubmit 引用，供 setState 的 updater 中异步消费副作用时读取，
   * 避免闭包捕获过期回调
   */
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  /**
   * 获取当前终端的宽度（以"列数"为单位），取不到则返回 null
   */
  const { columns } = useWindowSize();
  const screenWidth = getScreenWidth(columns);
  // 取不到宽度 后续的代码没有意义
  if (screenWidth === null) return null;

  // 输入框实际可用宽度 columns
  const inputColumns = getInputColumns(screenWidth);
  /**
   * 把终端环境信息打包成单一入参传给纯函数核心（reducer/视图选择器），
   * - 避免函数签名随环境维度增多而膨胀，方便后续扩展
   */
  const layout = { inputColumns };
  /**
   * 控制输入框是否响应键盘/粘贴事件，以及是否显示光标。
   */
  const isActive = !disabled && !isExiting;
  // 反色字符渲染：光标以反色字符内嵌进文本，由 Ink 的 diff 机制移动
  const view = selectInputBoxView(inputState, layout, isActive);

  /**
   * 输入框的事件分发器
   * @param event 已翻译好的用户动作
   */
  const dispatchInputEvent = (event: InputBoxEvent) => {
    setInputState((previous) => {
      // 把用户行为归约成新状态 { text, cursor } + 副作用
      const next = reduceInputBoxState(previous, event, layout);
      //  F1、无法识别的键、提交空内容、粘贴/插入空字符串
      if (next.state === previous && next.effects.length === 0) {
        /**
         * 返回当前状态，不触发重新渲染
         * 新值和旧值是同一个引用（===），React 会跳过这次渲染
         */
        return previous;
      }

      /**
       * 兑现副作用——把归约器产出的副作用描述（next.effects）逐个执行到真实世界
       */
      for (const effect of next.effects) {
        runInputBoxEffect(effect, { onSubmit: onSubmitRef.current });
      }

      return next.state;
    });
  };

  // 接收处理 Ink 传入的按键信息
  const handleInput = (input: string, key: Key) => {
    // 翻译成输入框能理解的事件，然后交给状态机处理。
    dispatchInputEvent(resolveInputBoxEvent(input, key));
  };

  useInput(handleInput, { isActive });
  usePaste((text) => dispatchInputEvent({ type: "insertText", text }), { isActive });

  const renderedText = view.renderedText || " ";

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
          <Text>{renderedText}</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default InputBox;
