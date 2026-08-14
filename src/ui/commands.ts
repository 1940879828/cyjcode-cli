import { getConfig, getConfigPath } from "../config/store.js";
import { handleModelCommand } from "./modelCommand.js";
import { handleEffortCommand } from "./effortCommand.js";
import { handleThinkingCommand } from "./thinkingCommand.js";
import { getDefaultSkillManager } from "../agent/runtime.js";

/** 命令类型，作为分发依据 */
export type SlashCommandKind =
  | "help"
  | "config"
  | "clear"
  | "setup"
  | "model"
  | "init"
  | "skills"
  | "skill"
  | "thinking"
  | "effort";

/** 命令执行时注入的依赖，把副作用从命令定义解耦出来 */
export interface SlashCommandContext {
  clearChat: () => void;
  startSetup: () => void;
}

export interface LocalSlashCommand {
  kind: SlashCommandKind;
  execution: "local";
  name: string;
  description: string;
  handler: (args: string[], ctx: SlashCommandContext) => string;
}

export interface AgentSlashCommand {
  kind: SlashCommandKind;
  execution: "agent";
  name: string;
  description: string;
}

export type SlashCommand = LocalSlashCommand | AgentSlashCommand;

export const slashCommands: SlashCommand[] = [
  {
    kind: "help",
    execution: "local",
    name: "/help",
    description: "显示所有可用命令",
    handler: () => {
      const lines = ["可用命令:", ""];
      for (const cmd of slashCommands) {
        lines.push(`  ${cmd.name.padEnd(15)} ${cmd.description}`);
      }
      return lines.join("\n");
    },
  },
  {
    kind: "config",
    execution: "local",
    name: "/config",
    description: "显示当前配置",
    handler: () => {
      const config = getConfig();
      const lines = [
        "当前配置:",
        "",
        `  配置文件: ${getConfigPath()}`,
        `  API Base URL: ${config.baseUrl}`,
        `  API Key: ${config.apiKey ? config.apiKey.slice(0, 8) + "..." + (config.apiKey.length > 8 ? config.apiKey.slice(-4) : "") : "(未设置)"}`,
        `  Model: ${config.model}`,
        `  Thinking: ${config.thinking ? "Enabled" : "Disabled"}`,
        `  Reasoning Effort: ${config.reasoningEffort}`,
      ];
      return lines.join("\n");
    },
  },
  {
    kind: "clear",
    execution: "local",
    name: "/clear",
    description: "清空对话历史",
    handler: (_args, ctx) => {
      ctx.clearChat();
      return "对话历史已清空";
    },
  },
  {
    kind: "setup",
    execution: "local",
    name: "/setup",
    description: "重新配置 API 连接",
    handler: (_args, ctx) => {
      ctx.startSetup();
      return "重新配置 API 连接…";
    },
  },
  {
    kind: "model",
    execution: "local",
    name: "/model",
    description: "查看、添加和切换模型",
    handler: (args) => handleModelCommand(args),
  },
  {
    kind: "thinking",
    execution: "local",
    name: "/thinking",
    description: "开启或关闭思考模式",
    handler: (args) => handleThinkingCommand(args),
  },
  {
    kind: "effort",
    execution: "local",
    name: "/effort",
    description: "设置 Reasoning Effort 推理强度",
    handler: (args) => handleEffortCommand(args),
  },
  {
    kind: "init",
    execution: "agent",
    name: "/init",
    description: "生成或更新 AGENTS.md 项目说明",
  },
  {
    kind: "skills",
    execution: "local",
    name: "/skills",
    description: "列出当前可用 skills",
    handler: () => getDefaultSkillManager().formatStatus(),
  },
];

export interface ParsedSlashCommand {
  command: SlashCommand;
  args: string[];
}

/**
 * 解析 "/clear foo bar" → { command, args: ["foo", "bar"] }。
 * 匹配命令名的第一个词，而非整行，以便支持带参数的命令。
 */
export function parseSlashInput(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const [name, ...args] = trimmed.split(/\s+/);
  const command = slashCommands.find((c) => c.name === name);
  if (!command) return parseSkillSlashCommand(name, args);

  return { command, args };
}

function parseSkillSlashCommand(name: string, args: string[]): ParsedSlashCommand | null {
  const skillName = name.slice(1);
  const skill = getDefaultSkillManager().list().find((item) => item.userInvocable && item.name === skillName);
  if (!skill) return null;
  return {
    command: {
      kind: "skill",
      execution: "agent",
      name,
      description: skill.description || `加载 skill: ${skill.name}`,
    },
    args,
  };
}
