import { getConfig, getConfigPath } from "../config/store.js";

/** 命令类型，作为分发依据 */
export type SlashCommandKind = "help" | "config" | "clear" | "setup";

/** 命令执行时注入的依赖，把副作用从命令定义解耦出来 */
export interface SlashCommandContext {
  clearChat: () => void;
  startSetup: () => void;
}

export interface SlashCommand {
  kind: SlashCommandKind;
  name: string;
  description: string;
  handler: (args: string[], ctx: SlashCommandContext) => string;
}

export const slashCommands: SlashCommand[] = [
  {
    kind: "help",
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
    name: "/clear",
    description: "清空对话历史",
    handler: (_args, ctx) => {
      ctx.clearChat();
      return "对话历史已清空";
    },
  },
  {
    kind: "setup",
    name: "/setup",
    description: "重新配置 API 连接",
    handler: (_args, ctx) => {
      ctx.startSetup();
      return "重新配置 API 连接…";
    },
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
  if (!command) return null;

  return { command, args };
}
