import { getConfig, setConfig } from "../config/store.js";
import type { AppConfig } from "../config/store.js";

export interface ThinkingCommandStore {
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
}

const DEFAULT_STORE: ThinkingCommandStore = { getConfig, setConfig };

export function handleThinkingCommand(
  args: string[],
  store: ThinkingCommandStore = DEFAULT_STORE,
): string {
  const [value = ""] = args;
  if (!value) return formatThinkingStatus(store.getConfig());

  const enabled = parseThinkingToggle(value);
  if (enabled === null) {
    return ["用法: /thinking <on|off>", "  on  开启思考", "  off 关闭思考"].join("\n");
  }

  const config = store.getConfig();
  store.setConfig({ ...config, thinking: enabled });
  return `已${enabled ? "开启" : "关闭"} Thinking`;
}

function formatThinkingStatus(config: AppConfig): string {
  return [
    `当前 Thinking: ${config.thinking ? "Enabled" : "Disabled"}`,
    "",
    "用法: /thinking <on|off>",
  ].join("\n");
}

function parseThinkingToggle(value: string): boolean | null {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}
