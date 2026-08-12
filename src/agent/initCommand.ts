import type { ChatMessage } from "../llm/types.js";
import { findProjectInstructionsPath } from "./projectInstructions.js";

export const INIT_COMMAND = "/init";

const REQUIRED_SECTIONS = [
  "项目概览",
  "目录约定",
  "开发约定",
  "修改前检查",
  "代码风格守则",
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

const INIT_PROMPT_REQUIREMENTS = [
  "开始前先检查仓库结构、package/scripts、测试命令、最近提交风格，以及当前稳定的本机开发环境和常用工具。只使用安全的只读命令，例如版本检查、路径检查、配置文件读取。",
  "完成检查后，使用文件写入或编辑工具创建/更新 AGENTS.md。",
  `文档应简洁、准确、可维护，优先记录长期有效的信息。必须包含这些章节:\n${formatRequiredSections()}`,
  `“修改前检查”章节必须包含这些检查项:\n${formatPreEditChecks()}`,
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
