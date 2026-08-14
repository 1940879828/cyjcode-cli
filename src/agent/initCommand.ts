import type { ChatMessage } from "../llm/types.js";
import { findProjectInstructionsPath } from "./projectInstructions.js";

export const INIT_COMMAND = "/init";

const REQUIRED_SECTIONS = [
  "项目概览",
  "目录约定",
  "开发约定",
  "修改前检查",
  "代码风格守则",
  "第一性原理",
  "禁止症状遮蔽式工程",
  "代码审查守则",
  "常用命令",
  "本机环境与工具",
  "Git 注意事项",
  "提交代码时",
  "安全与敏感信息",
];

const INIT_PROMPT_INTRO = "请生成或更新中文 AGENTS.md，作为本仓库给 AI 编程助手使用的长期项目说明。";

const PRE_EDIT_CHECKS = [
  "先阅读本文件并按约定执行。",
  "开始编辑前确认当前任务相关文件、调用方和测试。",
  "编辑前检查 `git status`，区分用户已有改动与本次改动。",
  "设计函数时默认不超过 20 行、参数不超过 3 个。",
  "完成后至少运行 `npm run typecheck`。",
];

const EXISTING_FILE_UPDATE_RULES = [
  "如果 AGENTS.md 已存在，必须先完整读取现有内容，再基于现有内容做合并式更新。",
  "保留用户已经写好的项目约定、个人偏好、特殊流程和安全限制，不得整体覆盖、重写或删改无关段落。",
  "只补充缺失的必备章节、修正已确认过期的信息、精简明显重复且等价的内容。",
  "如果现有内容与模板要求冲突，先保留现有内容并用最小修改对齐；无法判断时在文档中留下待确认项。",
];

const ENGINEERING_JUDGMENT_GUIDANCE = `第一性原理

遇到需求冲突、方案分歧、或要分析复杂需求时，回到第一性原理：

- 抛开“惯例就这么做”“上次那样做的”，先问这件事的根本目标和真实约束是什么。
- 把问题拆到不可再拆的事实层，再从事实重新推导方案，而不是类比套用现成答案。
- 冲突时先对齐双方真正要的底层目标——冲突往往只在表层，底层目标常可调和。

## 禁止症状遮蔽式工程

从第一性原理出发。遇到加载慢、白屏、闪烁、状态错乱、异步竞态、生命周期错位、偶现失败等问题时，禁止把延迟、截图遮盖、假 loading、静默吞错、无限重试、强制刷新、缓存旧画面等手段当作根因修复。

判断标准：

- 必须先解释真实因果链：哪个状态未就绪、哪个依赖缺失、哪个边界没有建模、哪个链路变慢或失败。
- 修复方案必须优先消除根因，而不是只降低用户感知或让异常变得不可见。
- 如果引入 \`delay\`、\`asyncAfter\`、\`postDelayed\`、截图占位、遮罩、额外 loading、吞错、重试、强刷等机制，提交前必须回答：这是根因修复还是症状遮蔽？
- 临时止血可以接受，但必须显式标注为 temporary mitigation，并写明退出条件、验证方式和后续根因修复任务；不得把止血包装成最终方案。`;

const INIT_PROMPT_REQUIREMENTS = [
  "开始前先检查仓库结构、package/scripts、测试命令、最近提交风格，以及当前稳定的本机开发环境和常用工具。只使用安全的只读命令，例如版本检查、路径检查、配置文件读取。",
  "完成检查后，使用文件写入或编辑工具创建/更新 AGENTS.md。",
  `如果 AGENTS.md 已存在，必须按以下规则更新:\n${formatExistingFileUpdateRules()}`,
  `文档应简洁、准确、可维护，优先记录长期有效的信息。必须包含这些章节:\n${formatRequiredSections()}`,
  `“修改前检查”章节必须包含这些检查项:\n${formatPreEditChecks()}`,
  `文档必须包含以下工程判断准则:\n${ENGINEERING_JUDGMENT_GUIDANCE}`,
  "“本机环境与工具”只记录已验证且对本项目有用的稳定信息，例如 OS、Shell、Node/npm、git、gh、FFmpeg 等工具的用途、常用命令、版本；只有在排障有价值时才写绝对路径。",
  "不要写入密钥、token、完整环境变量、冗长 PATH、临时会话信息或内部工具 schema。",
  "如果文档中记录的工具之后调用失败，应先排查并修复本机工具配置，修复后同步更新 AGENTS.md。",
];

export function renderInitCommandPrompt(startDir = process.cwd()): string {
  return [
    INIT_PROMPT_INTRO,
    getInitFileTask(startDir),
    ...INIT_PROMPT_REQUIREMENTS,
  ].join("\n\n");
}

export function expandInitCommandMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => isInitCommandMessage(message)
    ? { ...message, content: renderInitCommandPrompt() }
    : message);
}

function isInitCommandMessage(message: ChatMessage): boolean {
  return message.role === "user" && message.content?.trim() === INIT_COMMAND;
}

function getInitFileTask(startDir: string): string {
  return findProjectInstructionsPath(startDir)
    ? "请更新现有 AGENTS.md，保持与仓库当前状态一致。"
    : "请创建 ./AGENTS.md。";
}

function formatRequiredSections(): string {
  return REQUIRED_SECTIONS.map((section) => `- ${section}`).join("\n");
}

function formatPreEditChecks(): string {
  return PRE_EDIT_CHECKS.map((check) => `- ${check}`).join("\n");
}

function formatExistingFileUpdateRules(): string {
  return EXISTING_FILE_UPDATE_RULES.map((rule) => `- ${rule}`).join("\n");
}
