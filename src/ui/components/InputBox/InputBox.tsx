import { useRef, useState } from "react";
import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import type { Key } from "ink";
import stringWidth from "string-width";
import LoadingStatus from "../LoadingStatus/LoadingStatus.js";
import {
  createInputBoxState,
  getSubmittableText,
  reduceInputBoxState,
  resolveInputBoxCommand,
  selectInputBoxView,
} from "./inputBoxModel.js";
import type {
  InputBoxCommand,
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
  inputHistory?: readonly string[];
  // 为 true 时输入框不可输入
  disabled: boolean;
  // true 表示 App 正在退出 : isActive 变 false 隐藏光标
  isExiting?: boolean;
}

// 获取当前终端的宽度（以"列数"为单位），取不到则返回 null
const getScreenWidth = (columns: number | undefined): number | null =>
  columns ?? process.stdout.columns ?? null;

// 输入框实际可用的宽度（列数）
const getInputColumns = (screenWidth: number): number =>
  Math.max(1, screenWidth - PROMPT_WIDTH - 1);

const InputBox = ({
  onSubmit,
  inputHistory = [],
  disabled,
  isExiting = false,
}: Props) => {
  /**
   * 输入框核心状态（唯一事实来源）：包含文本编辑态与历史浏览态；
   * - 宽度/历史列表/回调/禁用态等外围状态不在此状态机内，分别走 layout 参数、ref、Props
   */
  const [inputState, setInputState] = useState<InputBoxState>(() =>
    createInputBoxState(),
  );
  const inputStateRef = useRef(inputState);
  /**
   * 缓存最新的 onSubmit 引用，供用户事件回调消费，避免闭包捕获过期回调
   * - useRef 初始化存一份；每次渲染用最新值覆盖
   */
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  /**
   * useInput 注册的回调可能晚于渲染执行，历史列表也用 ref 读取最新值。
   */
  const inputHistoryRef = useRef(inputHistory);
  inputHistoryRef.current = inputHistory;

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
   * 提交输入框状态快照：让事件回调能同步读到最新编辑态，同时交给 React 重渲染。
   */
  const commitInputState = (nextState: InputBoxState) => {
    if (nextState === inputStateRef.current) return;
    inputStateRef.current = nextState;
    setInputState(nextState);
  };

  /**
   * 输入框的编辑事件分发器
   * @param event 已翻译好的编辑动作
   */
  const dispatchInputEvent = (event: InputBoxEvent) => {
    commitInputState(
      reduceInputBoxState(
        inputStateRef.current,
        event,
        { layout, inputHistory: inputHistoryRef.current },
      ),
    );
  };

  /**
   * 输入框的命令分发器：编辑命令交给 reducer，提交命令在用户事件回调中触发外部副作用。
   * @param command 已翻译好的输入命令
   */
  const dispatchInputCommand = (command: InputBoxCommand) => {
    if (command.type === "edit") {
      /**
       * 这里只处理编辑状态，比如输入文字、删除、移动光标。最后会走
       * reduceInputBoxState
       * commitInputState
       */
      dispatchInputEvent(command.event);
      return;
    }

    // 历史浏览态提交等价于提交当前输入框文本；reset 会一起退出历史浏览。
    const text = getSubmittableText(inputStateRef.current);
    if (text === null) return;

    /**
     * 先更新输入框 state，清空输入框
     * 再调用 onSubmit 副作用
     * - *最佳实践 让State更新里不调用副作用
     * - 避免问题：可能因为 React 的调度、开发检查、重复渲染语义等，被以你不完全直观的方式调用。
     *   于是 onSubmit 这种“不应该重复”的操作就有重复执行或时机不清楚的风险。
     */
    commitInputState(createInputBoxState());
    // 副作用
    onSubmitRef.current(text);
  };

  // 接收处理 Ink 传入的按键信息
  const handleInput = (input: string, key: Key) => {
    // 翻译成输入框能理解的命令，然后交给命令分发器处理。
    dispatchInputCommand(resolveInputBoxCommand(input, key));
  };

  // 处理键盘输入事件
  useInput(handleInput, { isActive });
  // 接收处理粘贴事件
  usePaste((text) => dispatchInputEvent({ type: "insertText", text }), { isActive });

  const renderedText = view.renderedText || " ";

  return (
    <Box flexDirection="column" paddingX={0} marginTop={1}>
      {disabled && (
        <LoadingStatus />
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
