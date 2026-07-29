# cyjcode-cli

基于终端的 AI 编程助手 CLI 工具，使用 React + Ink 构建交互式终端 UI，通过 OpenAI API 提供 LLM 能力。

## 技术栈

- **运行时**: Node.js >= 22, TypeScript (ESM)
- **终端 UI**: React 19 + Ink 7
- **AI 引擎**: OpenAI SDK
- **编译优化**: Babel + React Compiler（自动 memoization）
- **打包**: esbuild

## 开发命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发模式，Babel 编译 + React Compiler + 热重载 |
| `npm run dev:tsx` | 裸 tsx 直接运行（无 React Compiler，启动最快） |
| `npm run devrecord` | 录制会话数据到 `mockdata/default.json` |
| `npm run devmock` | 从 `mockdata/default.json` 回放会话 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run build` | 生产构建：类型检查 → Babel → esbuild 打包 |

## 构建管线

```
npm run build
  ├─ tsc --noEmit             类型检查
  ├─ babel src → .babel-out/  TypeScript 转换 + React Compiler 注入 memoization
  └─ esbuild .babel-out/      ESM 打包 → dist/cli.js
```

## 开发模式

`npm run dev` 通过 `concurrently` 并行启动两个进程：

```
npm run dev
  ├─ babel --watch      监听 src/ 源码变化 → 自动重编译（含 React Compiler）
  └─ node --watch       监听 .babel-out/ 产物变化 → 自动重启应用
```

修改任何 `.ts`/`.tsx` 文件后自动重编译并重启，React Compiler 全程生效，无需手写 `memo`、`useMemo`、`useCallback`。
