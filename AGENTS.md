# AGENTS.md

## 项目概览

这是一个基于 Node.js、TypeScript、React 和 Ink 的终端 AI 编程助手 CLI。项目使用 ESM，运行环境要求 Node.js >= 22。

## 目录约定

- `src/cli.tsx`：CLI 入口和命令行参数处理。
- `src/ui/`：Ink/React 终端界面及交互逻辑。
- `src/agent/`：Agent 循环、上下文历史和提示词。
- `src/llm/`：OpenAI 客户端和 LLM 类型定义。
- `src/tools/`：提供给 Agent 使用的文件读写、搜索、重命名和目录浏览工具。
- `src/config/`：本地配置存储。
- `src/devmock/`：开发录制与 mock 回放，不参与生产构建。
- `src/ui/`：其中 `inputBoxModel.ts` 为输入框纯函数核心（reducer + 视图选择器），`InputBox.tsx` 只做装配、按键翻译与副作用消费，`textEditor.ts` 提供 `TextCursor` 纯计算原语。
- `tests/`：单元/集成测试，如 `tests/inputBoxModel.test.ts`（输入框核心逻辑）。
- `docs/`：需求、迭代计划和运维文档。
- `.babel-out/`、`dist/`：构建产物，不要手工修改，也不要提交。
- `mockdata/`：本地开发录制数据，不要提交真实敏感信息。

## 开发约定

- 使用 TypeScript 严格模式；优先保持现有类型定义，不要用 `any` 绕过类型检查。
- UI 使用 React + Ink；项目已启用 React Compiler，不需要手动添加 `memo`、`useMemo` 或 `useCallback` 来替代编译器优化。
- 保持 ESM 导入风格，并遵循现有文件的命名和组织方式。
- 修改前先阅读相关模块及其调用方，避免破坏 CLI 入口、Agent 工具协议和终端交互状态。
- 不要覆盖或回退用户已有的未提交修改；如修改与现有工作重叠，先保留并基于当前内容编辑。
- API key、用户配置、会话记录和本地 mock 数据不得写入源码、日志或提交内容。

## 提交代码时

- 生成中文的commit message
- 需要遵循之前的提交风格

## 代码风格守则

- 代码行为符合直觉，无惊奇，纯函数优先，副作用受控
- 表达「做什么」而非「怎么做」，优先用 `map/filter/reduce` 和高阶组合
- 每个函数只做一件事：不超过 20 行，参数不超过 3 个
- 命名即文档，严禁 `data`、`tmp`、`info`、`a`、`b`
- Early Return，缩进不超过 3 层
- 组合优于继承，依赖注入优于类继承链
- 不解释「做了什么」，只在必要处写「为什么」
- 只在出现第二处相同代码时才抽象，不过早 DRY
- 业务逻辑（纯函数）与 I/O/框架严格分离
- 第一性原理：回归问题本质思考，不盲从现有方案，不复制惯性做法
- 奥卡姆剃刀：如无必要勿增实体，优先选最简单的实现
- 不需要useMemo、memo和useCallback，项目有React19 Compiler

## 输入框架构约定（InputBox）

输入框为「纯函数核心 + 精简 UI」分层，状态与 React 解耦：

- 状态单一来源为 `InputBoxState`；按键经 `resolveInputBoxEvent` 翻译成 `InputBoxEvent`，再由 `reduceInputBoxState` 产出 `{ state, effects }`。
- 副作用（提交等）以 `effects` 数组返回，由 UI 层消费，reducer 保持纯函数。
- 视图由 `selectInputBoxView` 独立推导；新增功能（历史、下拉框）只在 `inputBoxModel.ts` 加状态与分支，UI 几乎不动。
- 该核心逻辑须有单元测试，改动后运行 `npm run test:inputbox`。

## 常用命令

```bash
npm run dev          # Babel watch + Node watch 开发模式
npm run dev:tsx      # 使用 tsx 直接运行，适合快速调试
npm run typecheck    # TypeScript 类型检查
npm run build        # 类型检查、Babel 编译并打包
npm run test:inputbox# 运行输入框核心单元测试
npm run devrecord    # 录制默认开发会话
npm run devmock      # 回放 mockdata/default.json
```

完成代码修改后，至少运行 `npm run typecheck`；修改 `src/ui/inputBoxModel.ts` 还需运行 `npm run test:inputbox`；涉及构建流程、入口或打包行为的修改还要运行 `npm run build`。如果测试或验证因环境、凭据或外部服务不可用而跳过，应在交付说明中明确写出。

## Git 注意事项

- 提交前检查 `git status` 和 `git diff`，只包含当前任务相关的文件。
- 不要使用破坏性回退命令覆盖用户工作区。
- 默认不提交构建产物、`node_modules`、`mockdata` 或包含凭据的文件。
