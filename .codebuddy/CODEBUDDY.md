# AGENTS.md

## 项目概览

这是一个基于 Node.js、TypeScript、React 和 Ink 的终端 AI 编程助手 CLI。项目使用 ESM，运行环境要求 Node.js >= 22。

## 目录约定

- `src/cli.tsx`：生产 CLI 入口和命令行参数处理。
- `src/ui/`：Ink/React 终端界面及交互逻辑；组件采用「一个组件一个目录 + index.ts 索引导出」组织，通用 UI hooks 放在 `src/ui/hooks/`。
- `src/agent/`：Agent 循环、上下文历史和提示词。
- `src/llm/`：OpenAI 客户端和 LLM 类型定义。
- `src/tools/`：提供给 Agent 使用的文件读写、搜索、重命名和目录浏览工具。
- `src/config/`：本地配置存储。
- `src/devmock/`：开发录制与 mock 回放，只通过开发脚本使用，不进入生产构建。
- `src/ui/components/InputBox/`：其中 `inputBoxModel.ts` 为输入框纯函数核心（command 翻译 + reducer + 视图选择器），`InputBox.tsx` 只做装配、命令分发与提交回调消费，`textEditor.ts` 提供 `TextCursor` 纯计算原语。
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

## 修改前检查

- 先阅读本文件并按约定执行。
- 开始编辑前确认当前任务相关文件、调用方和测试。
- 编辑前检查 `git status`，区分用户已有改动与本次改动。
- 设计函数时默认不超过 20 行、参数不超过 3 个。
- 完成后至少运行 `npm run typecheck`。

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
- 开发时不得只改代码不改注释：代码逻辑变化时，必须同步更新相关注释；修改 `AGENTS.md` 与 `.codebuddy/CODEBUDDY.md` 中任一文件时，必须同步修改另一份，保持两份内容一致
- PowerShell 默认必须使用 UTF-8：会话开始先设置 `$utf8 = [System.Text.UTF8Encoding]::new(); [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8`；读取文件时显式使用 `Get-Content -Encoding UTF8`，不得依赖系统默认编码
- 只在出现第二处相同代码时才抽象，不过早 DRY
- 业务逻辑（纯函数）与 I/O/框架严格分离
- 第一性原理：回归问题本质思考，不盲从现有方案，不复制惯性做法
- 奥卡姆剃刀：如无必要勿增实体，优先选最简单的实现
- 不需要useMemo、memo和useCallback，项目有React19 Compiler

## 第一性原理

遇到需求冲突、方案分歧、或要分析复杂需求时，回到第一性原理：

- 抛开“惯例就这么做”“上次那样做的”，先问这件事的根本目标和真实约束是什么。
- 把问题拆到不可再拆的事实层，再从事实重新推导方案，而不是类比套用现成答案。
- 冲突时先对齐双方真正要的底层目标——冲突往往只在表层，底层目标常可调和。

## 禁止症状遮蔽式工程

从第一性原理出发。遇到加载慢、白屏、闪烁、状态错乱、异步竞态、生命周期错位、偶现失败等问题时，禁止把延迟、截图遮盖、假 loading、静默吞错、无限重试、强制刷新、缓存旧画面等手段当作根因修复。

判断标准：

- 必须先解释真实因果链：哪个状态未就绪、哪个依赖缺失、哪个边界没有建模、哪个链路变慢或失败。
- 修复方案必须优先消除根因，而不是只降低用户感知或让异常变得不可见。
- 如果引入 `delay`、`asyncAfter`、`postDelayed`、截图占位、遮罩、额外 loading、吞错、重试、强刷等机制，提交前必须回答：这是根因修复还是症状遮蔽？
- 临时止血可以接受，但必须显式标注为 temporary mitigation，并写明退出条件、验证方式和后续根因修复任务；不得把止血包装成最终方案。

## 代码审查守则

- 审查以验证行为是否符合需求、注释、类型契约和测试为目标；先还原预期行为，再判断实现是否矛盾，不以“找出问题”为前提。
- 正确性结论必须给出完整证据链：具体输入或状态、实际经过的分支、产生的结果、与预期的差异；三元表达式和复杂条件须分别代入真假分支验证。
- 结构相似或成对出现的代码必须独立追踪执行语义，再比较差异；不得依据命名、排列或表面对称性推断另一侧行为。
- 判断局部代码前须核对相关调用方、状态转换和已有测试；可运行时用最小复现或测试验证，不根据孤立代码片段下结论。
- 明确区分“已确认缺陷”“潜在风险”和“产品取舍”；只有可复现且违反既定契约的行为才标记为缺陷，不确定项须说明假设与验证缺口。

## 输入框架构约定（InputBox）

输入框为「纯函数核心 + 精简 UI」分层，状态与 React 解耦：

- 状态单一来源为 `InputBoxState`；按键经 `resolveInputBoxCommand` 翻译成 `InputBoxCommand`，编辑命令再由 `reduceInputBoxState` 产出新状态。
- 提交规则由 `getSubmittableText` 纯函数判断；提交回调只在 UI 层的 submit 命令分支触发，reducer 不产出副作用。
- 视图由 `selectInputBoxView` 独立推导；新增功能（历史、下拉框）只在 `inputBoxModel.ts` 加状态与分支，UI 几乎不动。
- 该核心逻辑须有单元测试，改动后运行 `npm run test:inputbox`。

## 常用命令

```bash
npm run dev          # tsx --watch 直接运行 CLI
npm run dev:tsx      # tsx 单次运行 CLI
npm run dev:babel    # Babel watch + React Compiler + Node watch
npm run typecheck    # TypeScript 类型检查
npm run build        # 类型检查、Babel 编译并打包
npm run test:inputbox# 运行输入框核心单元测试
npm run devrecord    # 开发入口录制默认会话
npm run devmock      # 开发入口回放 mockdata/default.json
npm run typecheck:test # 测试文件 TypeScript 类型检查
npm run test:all     # 运行全部测试
```

完成代码修改后，至少运行 `npm run typecheck`；修改 `src/ui/components/InputBox/inputBoxModel.ts` 还需运行 `npm run test:inputbox`；涉及构建流程、入口或打包行为的修改还要运行 `npm run build`。如果测试或验证因环境、凭据或外部服务不可用而跳过，应在交付说明中明确写出。

## Git 注意事项

- 提交前检查 `git status` 和 `git diff`，只包含当前任务相关的文件。
- 不要使用破坏性回退命令覆盖用户工作区。
- 默认不提交构建产物、`node_modules`、`mockdata` 或包含凭据的文件。
