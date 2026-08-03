# cyjcode-cli 项目说明

## 项目概述

cyjcode 是一个基于终端的 AI 编程助手 CLI 工具，使用 React + Ink 构建交互式终端 UI，通过 OpenAI API 提供 LLM 能力。

## 技术栈

- **运行时**: Node.js >= 22, TypeScript 6.x (ESM 模块)
- **终端 UI**: React 19 + Ink 7
- **AI 引擎**: OpenAI SDK (openai ^6.44.0)
- **CLI 框架**: yargs ^18.0.0
- **数据验证**: zod ^4.4.3
- **打包工具**: esbuild
- **开发运行**: tsx

## 项目结构

```
src/
  agent/    - Agent 核心逻辑
  config/   - 配置管理
  init/     - 初始化逻辑
  llm/      - LLM 调用封装
  test/     - 测试代码
  tools/    - 工具集
  ui/       - Ink 终端 UI 组件
  utils/    - 工具函数
  cli.tsx   - CLI 入口
```

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

---

## 技术规范

- 使用 ES2022 标准，ESM 模块（`import/export`）
- 代码严格遵循 TypeScript strict 模式
- 模块解析使用 NodeNext
- JSX 使用 `react-jsx` 模式（无需显式 `import React`）
- 所有源文件放在 `src/` 目录下

## 开发命令

- `npm run dev` - 开发模式运行（tsx 直接执行）
- `npm run build` - 类型检查 + esbuild 打包
- `npm run typecheck` - 仅类型检查

## 提交代码时

- 生成中文的commit message
- 需要遵循之前的提交风格
