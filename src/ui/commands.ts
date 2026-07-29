import { getConfig, getConfigPath } from "../config/store.js";

export interface Command {
  name: string;
  description: string;
  handler: () => string;
}

export const commands: Command[] = [
  {
    name: "/help",
    description: "显示所有可用命令",
    handler: () => {
      const lines = ["可用命令:", ""];
      for (const cmd of commands) {
        lines.push(`  ${cmd.name.padEnd(15)} ${cmd.description}`);
      }
      return lines.join("\n");
    },
  },
  {
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
    name: "/clear",
    description: "清空对话历史",
    handler: () => "",
  },
  {
    name: "/setup",
    description: "重新配置 API 连接",
    handler: () => "",
  },
];

export function matchCommand(input: string): Command | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  return commands.find((c) => c.name === trimmed) || null;
}
