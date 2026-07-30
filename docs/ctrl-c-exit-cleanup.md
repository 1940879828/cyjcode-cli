# Ctrl+C 退出样式残留问题处理记录

## 问题现象

在主聊天界面按 `Ctrl+C` 退出时，终端偶尔会残留 Ink 渲染中的样式或光标状态，例如颜色、dim/bold 样式、隐藏光标状态、输入框局部画面等没有完全恢复。

这个问题通常不是业务状态错误，而是退出发生得太快：React/Ink 还没来得及提交最后一帧清理渲染，进程就已经进入退出流程。

## 根因

原先依赖 Ink 默认的 `exitOnCtrlC` 行为时，`Ctrl+C` 会直接触发退出。对于这个项目的主界面来说不够稳，因为界面里同时存在：

- `useCursor()` 控制的原生终端光标位置。
- 输入框、SetupWizard 等组件的 active input 状态。
- streaming / disabled / exiting 等会影响渲染的状态。
- Ink 自己的最终 render flush 和 terminal cleanup。

如果直接退出，最后一次“关闭输入、隐藏/释放 cursor、刷新画面”的 React commit 可能还没有落到终端，于是看起来像样式残留。

## 最终方案

主聊天界面不再使用 Ink 默认 `Ctrl+C` 退出，而是由 `App` 自己接管退出流程。

### 1. CLI 关闭默认 Ctrl+C 退出

主界面启动时传入：

```ts
startInk(React.createElement(App), { exitOnCtrlC: false });
```

这样 `Ctrl+C` 不会绕过应用状态直接退出。

位置：`src/cli.tsx`

### 2. App 捕获 Ctrl+C 并进入 exiting 状态

`App` 中用 `useInput` 监听 `Ctrl+C`，触发 `requestExit()`：

```ts
if ((key.ctrl && input.toLowerCase() === "c") || input === "\u0003") {
  requestExit();
}
```

`requestExit()` 只做一件事：设置 `isExiting=true`。同时用 `exitingRef` 防止重复触发退出。

位置：`src/ui/App.tsx`

### 3. 先让 UI 进入不可输入状态

`isExiting` 会传给输入组件：

```tsx
<InputBox onSubmit={handleSubmit} disabled={isStreaming} isExiting={isExiting} />
```

SetupWizard 也同样接收 `isExiting`。

输入组件收到 `isExiting=true` 后会停止接收输入，并且不再声明终端 cursor：

```ts
const isActive = !disabled && !isExiting;
```

这一步很关键。它给 Ink 一个机会提交“输入已失活、cursor 已释放”的最后一帧。

位置：

- `src/ui/App.tsx`
- `src/ui/InputBox.tsx`
- `src/ui/SetupWizard.tsx`

### 4. 等待 Ink 刷新完成后再 exit

`App` 监听 `isExiting`，进入退出状态后先等待 Ink flush：

```ts
await waitUntilRenderFlush();
exit();
```

这样可以确保最后一帧已经写入终端，然后再交给 Ink 执行退出清理。

位置：`src/ui/App.tsx`

## 为什么不能直接 process.exit()

`process.exit()` 会跳过 Ink 的正常 cleanup 流程，风险更高：

- 终端 cursor 可能保持隐藏。
- ANSI 样式可能没有 reset。
- 最后一帧可能没有擦除或刷新。
- async cleanup 没有机会执行。

所以这里使用的是 Ink 的 `exit()`，并在调用前等待 `waitUntilRenderFlush()`。

## 验证方式

运行：

```bash
npm run devmock
```

验证以下场景：

- 空界面直接按 `Ctrl+C`，终端样式恢复正常。
- 输入框内有文字时按 `Ctrl+C`，不会残留输入框光标或颜色。
- mock 回复 streaming 过程中按 `Ctrl+C`，退出后终端不残留 cyan/gray/dim 样式。
- 首次配置 SetupWizard 中按 `Ctrl+C`，输入状态能停止，终端能正常恢复。

## 维护注意

- 主聊天入口保持 `exitOnCtrlC: false`。
- 不要在主 UI 中直接调用 `process.exit()`。
- 新增会控制 cursor/input 的组件时，需要接入 `isExiting` 或等价的退出失活状态。
- 退出前仍应通过 `waitUntilRenderFlush()` 等待最后一帧提交。
