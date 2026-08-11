# InputBox 学习总结 QA

> 本文件非规范、仅学习用，实现以源码为准。

> 适用范围：`src/ui/components/InputBox` 当前的 command 分发版本。
>
> 核心线索：终端里没有真实输入框，`InputBox` 是用 Ink 监听键盘、用纯函数维护编辑状态、再把状态渲染成文本。

---

## 总览

### Q1: InputBox 的主流程是什么？

**A:** 可以从这一句开始读：

```ts
dispatchInputCommand(resolveInputBoxCommand(input, key));
```

它把一次键盘输入拆成两步：

1. `resolveInputBoxCommand(input, key)`：把 Ink 给出的原始按键翻译成输入框命令。
2. `dispatchInputCommand(command)`：执行命令。

命令目前只有两类：

```ts
type InputBoxCommand =
  | { type: "edit"; event: InputBoxEvent }
  | { type: "submit" };
```

所以整体链路是：

```text
键盘输入 input/key
→ resolveInputBoxCommand
→ dispatchInputCommand
   → edit   → reduceInputBoxState → commitInputState
   → submit → getSubmittableText → commitInputState(reset) → onSubmit
→ React 重新渲染
→ selectInputBoxView 生成 renderedText
```

---

## 终端输入框

### Q2: 为什么没有真正的 `<input>`？

**A:** 因为 Ink 渲染的是终端 UI，不是浏览器 DOM。终端里没有原生 input 控件。

这个组件的输入来自：

```ts
useInput(handleInput, { isActive });
usePaste((text) => dispatchInputEvent({ type: "insertText", text }), { isActive });
```

显示出来的“输入框”其实是：

```tsx
<Box borderStyle="single">
  <Text>{PROMPT}</Text>
  <Box width={inputColumns}>
    <Text>{renderedText}</Text>
  </Box>
</Box>
```

也就是说：

- `useInput` / `usePaste` 负责收集用户输入；
- `InputBoxState` 负责保存文本和光标位置；
- `selectInputBoxView` 把状态转成终端要显示的字符串；
- Ink 的 `<Box>` 和 `<Text>` 负责布局与绘制。

---

### Q3: 光标是怎么显示出来的？

**A:** 现在不用真实终端光标，而是把“光标”渲染成文本里的一个反色字符。

关键逻辑在 `TextCursor.renderWithCursor()`：

- 光标压在某个字符上：反色这个字符；
- 光标在行尾或空行：追加一个反色空格；
- 反色靠 ANSI 控制码完成。

类似这一段：

```ts
`${fgCode}\u001B[7m${text}\u001B[27m${ANSI_FG_RESET}`
```

含义是：

- `fgCode`：设置前景色；
- `\u001B[7m`：开启反色；
- `text`：要显示成光标的字符；
- `\u001B[27m`：关闭反色；
- `ANSI_FG_RESET`：重置前景色。

先设置蓝色前景，再开启反色，终端显示出来就像一个蓝色背景块。

---

## Command 分发

### Q4: 为什么要引入 `InputBoxCommand`？

**A:** 因为“编辑”和“提交”不是同一种事情。

编辑是改变输入框内部状态，比如：

- 输入文字；
- 删除文字；
- 移动光标；
- 插入换行。

提交则是把当前文本交给上层：

- 需要读取当前文本；
- 需要判断空输入；
- 需要清空输入框；
- 需要调用 `onSubmit`，这属于外部副作用。

所以现在用 command 把两类动作区分开：

```ts
{ type: "edit", event }
{ type: "submit" }
```

这样 reducer 只处理编辑状态，提交副作用留在 UI 事件回调里处理。

---

### Q5: `dispatchInputCommand` 做了什么？

**A:** 它是命令执行器。

```ts
const dispatchInputCommand = (command: InputBoxCommand) => {
  if (command.type === "edit") {
    dispatchInputEvent(command.event);
    return;
  }

  const text = getSubmittableText(inputStateRef.current);
  if (text === null) return;

  commitInputState(createInputBoxState());
  onSubmitRef.current(text);
};
```

分两条路径：

```text
edit:
  dispatchInputEvent
  → reduceInputBoxState
  → commitInputState

submit:
  getSubmittableText
  → 空输入则 return
  → commitInputState(createInputBoxState())
  → onSubmitRef.current(text)
```

最重要的变化是：副作用 `onSubmitRef.current(text)` 不再出现在 `setState` updater 里。

---

### Q6: “State 更新里不调用副作用”到底避免了什么？

**A:** 避免把真实世界操作绑到 React 的状态调度过程里。

不推荐的形态是：

```ts
setInputState((previous) => {
  const next = reduceInputBoxState(previous, event, context);
  onSubmit(text);
  return next;
});
```

问题在于 updater 应该只计算 next state。React 可以为了调度、开发检查或并发语义，用不完全直观的时机调用它。`onSubmit` 这种“不应该重复”的操作放进去，会有重复执行或时机不清楚的风险。

现在的形态是：

```ts
commitInputState(createInputBoxState());
onSubmitRef.current(text);
```

它明确表达：

1. 先更新输入框状态，清空输入框；
2. 再触发提交副作用。

这条路径发生在用户事件回调里，读起来和执行时机都更直接。

---

## State 与 Ref

### Q7: 为什么既有 `inputState`，又有 `inputStateRef`？

**A:** 两者服务不同目的。

`inputState` 是 React state，用来驱动渲染：

```ts
const [inputState, setInputState] = useState<InputBoxState>(() =>
  createInputBoxState(),
);
```

`inputStateRef` 是事件回调里的最新状态快照：

```ts
const inputStateRef = useRef(inputState);
```

因为键盘事件回调可能闭包捕获旧状态，所以提交和编辑分发时读取：

```ts
inputStateRef.current
```

再通过：

```ts
commitInputState(nextState);
```

同时更新 ref 和 React state。

---

### Q8: `commitInputState` 为什么要判断引用相等？

**A:** 为了跳过无意义更新。

```ts
const commitInputState = (nextState: InputBoxState) => {
  if (nextState === inputStateRef.current) return;
  inputStateRef.current = nextState;
  setInputState(nextState);
};
```

当 reducer 判断某个事件不改变状态时，会返回原状态引用。比如：

- 空字符串插入；
- 未识别快捷键；
- 光标已经在边界还继续移动。

这时 `nextState === inputStateRef.current`，直接 return，避免多余渲染。

---

### Q9: 为什么需要 `onSubmitRef`？

**A:** 为了避免事件回调拿到旧的 `onSubmit`。

```ts
const onSubmitRef = useRef(onSubmit);
onSubmitRef.current = onSubmit;
```

`useInput` 注册的是事件回调。事件回调可能持有旧 render 里的变量。如果直接调用 `onSubmit(text)`，存在 stale closure 风险。

用 ref 后，提交时调用：

```ts
onSubmitRef.current(text);
```

就能确保读到最新的 `onSubmit`。

---

## 纯函数核心

### Q10: `reduceInputBoxState` 现在负责什么？

**A:** 负责输入框纯状态变化，包括文本编辑态与历史浏览态。

它接收：

```ts
state + event + context(layout + inputHistory)
```

返回：

```ts
nextState
```

它不提交、不调用外部回调、不做 I/O。

这让它可以独立单测，例如：

- 插入文本；
- 删除字符；
- 按词删除；
- 上下左右移动光标；
- reset。

---

### Q11: `getSubmittableText` 为什么单独抽出来？

**A:** 因为“能不能提交”是业务规则，但不是副作用。

```ts
export const getSubmittableText = (state: InputBoxState): string | null => {
  const text = state.editor.text;
  return text.trim() ? text : null;
};
```

它集中表达提交规则：

- trim 只用于判空；
- trim 后为空则不能提交；
- 可提交时返回原始文本，保留多行 prompt 的首尾空白和缩进。

这样 UI 层不用自己重复写判空逻辑，测试也能直接覆盖这条规则。

---

### Q12: `usePaste` 为什么直接 dispatch `insertText`，不走 command 解析？

**A:** 因为粘贴不是单个按键命令，而是一段文本插入。

```ts
usePaste((text) => dispatchInputEvent({ type: "insertText", text }), { isActive });
```

它天然就是编辑事件，不需要经过 `resolveInputBoxCommand`。

可以理解为：

- `useInput`：按键输入源，需要解析成 command；
- `usePaste`：文本输入源，可以直接进入 reducer。

---

## 扩展题

### Q13: 历史命令和上下箭头的逻辑在哪里？

**A:** 优先改 `inputBoxModel.ts`。

当前结构是：

1. `InputBoxState.historyBrowsing` 保存 `{ index, draft } | null`；`draft` 是进入历史浏览前的普通输入快照。
2. `InputBoxEvent` 使用 `upLineOrHistory` / `downLineOrHistory` 表达上下键的高层意图。
3. `resolveInputBoxCommand` 不读状态，只把 plain 上下键翻译成 line-or-history 事件。
4. `reduceInputBoxState` 根据 state、layout、inputHistory 判断移动视觉行还是切换历史，并在越过最新历史时恢复 draft。
5. `appendInputHistory` 负责提交后的历史入账：保存原始可提交文本，只跳过连续完全相同项。
6. `tests/inputBoxModel.test.ts` 覆盖视觉行移动、历史切换、边界忽略和草稿恢复。

`InputBox.tsx` 理想情况下只需要继续分发 command，不应该塞进大量历史逻辑。

---

### Q14: 这套架构最大的价值是什么？

**A:** 把三件事分清楚：

```text
输入解析：resolveInputBoxCommand
状态变化：reduceInputBoxState
副作用执行：dispatchInputCommand 的 submit 分支
```

收益是：

- 输入规则可读：一眼能看出 Enter 是 submit，Shift+Enter 是插入换行；
- reducer 保持纯函数：状态变化容易测试，也不依赖 React/Ink；
- 副作用位置明确：`onSubmit` 只在 submit command 分支里触发；
- 扩展更稳：新增编辑能力优先改 model，UI 层保持轻。

一句话总结：`InputBox.tsx` 像适配器，`inputBoxModel.ts` 像输入框的大脑。
