# cyjcode-cli 项目说明

## 项目概述

cyjcode 是一个基于终端的 AI 编程助手 CLI 工具，使用 React + Ink 构建交互式终端 UI，通过 OpenAI API 提供 LLM 能力。

## 技术栈

- **运行时**: Node.js >= 22, TypeScript 6.x (ESM 模块)
- **终端 UI**: React 19 + Ink 7
- **AI 引擎**: OpenAI SDK (openai ^6.44.0)
- **CLI 框架**: yargs ^18.0.0
- **数据验证**: zod ^4.4.3
- **编译**: Babel（编译）+ esbuild（打包）
- **开发运行**: tsx
- **测试**: node 内置 test runner + tsx

## 项目结构

```
src/
  agent/    - Agent 核心逻辑
  config/   - 配置管理
  devmock/  - 开发录制与 mock 回放，不参与生产构建
  init/     - 初始化逻辑
  llm/      - LLM 调用封装
  test/     - 测试代码
  tools/    - 工具集
  ui/       - Ink 终端 UI 组件
    components/    - 纯展示子组件（如 Header）
    inputBoxModel.ts - 输入框纯函数核心（状态机 + reducer + 视图选择器）
    InputBox.tsx     - 输入框 UI，只做装配、按键翻译与副作用消费
    textEditor.ts    - 文本编辑原语（TextCursor 类，纯计算）
  utils/    - 工具函数
  cli.tsx   - CLI 入口
tests/     - 集成/单元测试（如 inputBoxModel.test.ts）
```

## 代码风格守则

- 代码行为符合直觉，无惊奇，纯函数优先，副作用受控
- 表达「做什么」而非「怎么做」，优先用 `map/filter/reduce` 和高阶组合
- 每个函数只做一件事：不超过 20 行，参数不超过 3 个
- 命名即文档，严禁 `data`、`tmp`、`info`、`a`、`b`
- Early Return，缩进不超过 3 层
- 组合优于继承，依赖注入优于类继承链
- 不解释「做了什么」，只在必要处写「为什么」
- 开发时不得只改代码不改注释：代码逻辑变化时，必须同步更新相关注释；修改 `.codebuddy/CODEBUDDY.md` 与 `AGENTS.md` 中任一文件时，必须同步修改另一份，保持两份内容一致
- 只在出现第二处相同代码时才抽象，不过早 DRY
- 业务逻辑（纯函数）与 I/O/框架严格分离
- 第一性原理：回归问题本质思考，不盲从现有方案，不复制惯性做法
- 奥卡姆剃刀：如无必要勿增实体，优先选最简单的实现
- 不需要useMemo、memo和useCallback，项目有React19 Compiler

## 输入框架构约定（InputBox）

输入框采用「纯函数核心 + 精简 UI」的分层，状态和操作逻辑与 React 完全解耦：

- **状态单一来源**：`InputBoxState` 是唯一状态事实来源，按键事件经 `resolveInputBoxEvent` 翻译成 `InputBoxEvent`，再由 `reduceInputBoxState` 产出 `{ state, effects }`。
- **副作用显式建模**：I/O（如提交）以 `effects` 数组返回，由 UI 层延迟消费，reducer 保持纯函数。
- **视图选择器独立**：`selectInputBoxView` 从状态推导渲染文本与光标位置，与状态变更分开。
- **扩展新功能**（⬆️⬇️历史、补全下拉框等）：只在 `inputBoxModel.ts` 增加状态维度与 reducer 分支，UI 几乎不动。
- 该核心逻辑有独立单元测试（`tests/inputBoxModel.test.ts`）。

---

## 技术规范

- 使用 ES2022 标准，ESM 模块（`import/export`）
- 代码严格遵循 TypeScript strict 模式
- 模块解析使用 NodeNext
- JSX 使用 `react-jsx` 模式（无需显式 `import React`）
- 所有源文件放在 `src/` 目录下

## 开发命令

- `npm run dev` - Babel watch + Node watch 开发模式
- `npm run dev:tsx` - tsx 直接运行，适合快速调试
- `npm run build` - 类型检查 + Babel 编译 + esbuild 打包
- `npm run typecheck` - 仅类型检查
- `npm run test:inputbox` - 运行输入框核心单元测试

## 提交代码时

- 生成中文的commit message
- 需要遵循之前的提交风格
