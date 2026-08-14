# tigacode-cli

基于终端的 AI 编程助手 CLI 工具，使用 React + Ink 构建交互式终端 UI，通过 OpenAI API 兼容接口提供 LLM 能力。

## 技术栈

- **运行时**: Node.js >= 22, TypeScript (ESM)
- **终端 UI**: React 19 + Ink 7
- **AI 引擎**: OpenAI SDK
- **编译优化**: Babel + React Compiler
- **打包**: esbuild

## 开发命令

| 命令                  | 说明                                             |
|---------------------|------------------------------------------------|
| `npm run dev`       | 使用 `tsx --watch` 直接运行 CLI，启动最快                 |
| `npm run dev:tsx`   | 使用 `tsx` 单次运行 CLI                              |
| `npm run dev:babel` | Babel watch + React Compiler + Node watch 开发模式 |
| `npm run devrecord` | 通过开发专用入口录制会话到 `mockdata/default.json`          |
| `npm run devmock`   | 通过开发专用入口回放 `mockdata/default.json`             |
| `npm run typecheck` | TypeScript 类型检查                                |
| `npm run typecheck:test` | 测试文件 TypeScript 类型检查                         |
| `npm run test:all`  | 类型检查测试文件并运行全部 `tests/*.test.ts`              |
| `npm run build`     | 生产构建：类型检查 → Babel → esbuild 打包                 |

## 构建管线

```bash
npm run build
  ├─ tsc --noEmit             类型检查
  ├─ babel src → .babel-out/  TypeScript 转换 + React Compiler
  └─ esbuild .babel-out/      ESM 打包 → dist/cli.js
```

生产入口不包含 `src/devmock/`，录制和回放只通过 `npm run devrecord`、`npm run devmock` 使用。

## 安装使用

```bash
npm install -g tigacode-cli
tigacode
```

## 发布

```bash
npm login
npm run prepare:package
npm publish
```

`prepare:package` 会先运行生产构建，再用 `npm pack --dry-run --json --ignore-scripts` 校验发布包内容。
