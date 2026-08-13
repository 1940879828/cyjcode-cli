import { getConfig, setConfig, REASONING_EFFORTS } from "../config/store.js";
import type { AppConfig, ReasoningEffort } from "../config/store.js";

export interface EffortCommandStore {
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
}

const DEFAULT_STORE: EffortCommandStore = { getConfig, setConfig };

export function handleEffortCommand(
  args: string[],
  store: EffortCommandStore = DEFAULT_STORE,
): string {
  const [value = ""] = args;
  if (!value) return formatEffortStatus(store.getConfig());
  if (!isReasoningEffort(value)) return formatInvalidEffort(value);

  const config = store.getConfig();
  store.setConfig({ ...config, reasoningEffort: value });
  return formatEffortApplied(value, config.thinking);
}

function formatEffortStatus(config: AppConfig): string {
  return [
    `当前 Reasoning Effort: ${config.reasoningEffort}`,
    "",
    `可选值: ${REASONING_EFFORTS.join(" | ")}`,
    "",
    "用法: /effort <low|medium|high|xhigh|max>",
  ].join("\n");
}

function formatInvalidEffort(value: string): string {
  return [
    `无效的 Reasoning Effort: ${value}`,
    `可选值: ${REASONING_EFFORTS.join(" | ")}`,
  ].join("\n");
}

function formatEffortApplied(value: ReasoningEffort, thinking: boolean): string {
  const lines = [`已设置 Reasoning Effort: ${value}`];
  if (!thinking) lines.push("提示: Thinking 已关闭，该设置暂不生效");
  return lines.join("\n");
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}
