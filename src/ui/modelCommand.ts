import { createModelConfig, getConfig, parseContextWindow, setConfig } from "../config/store.js";
import type { AppConfig, ModelConfig } from "../config/store.js";

export interface ModelCommandStore {
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
}

const DEFAULT_STORE: ModelCommandStore = { getConfig, setConfig };
const REMOVE_COMMANDS = new Set(["remove", "rm", "delete"]);

export function handleModelCommand(
  args: string[],
  store: ModelCommandStore = DEFAULT_STORE,
): string {
  const [command = "list", ...restArgs] = args;
  if (command === "help") return formatModelHelp();
  if (command === "list" || command === "current") return formatModelList(store.getConfig());
  if (command === "use" || command === "switch") return switchModel(restArgs, store);
  if (command === "add") return addModel(restArgs, store);
  if (REMOVE_COMMANDS.has(command)) return removeModel(restArgs.join(" "), store);
  return switchModel(args, store);
}

interface ModelInput {
  name: string;
  contextWindow?: number;
}

function switchModel(args: string[], store: ModelCommandStore): string {
  const input = parseModelInput(args);
  if (!input) return formatModelHelp();

  const config = store.getConfig();
  const models = upsertModelConfig(config.models, input);
  store.setConfig({ ...config, model: input.name, models });
  return `已切换模型: ${input.name}`;
}

function addModel(args: string[], store: ModelCommandStore): string {
  const input = parseModelInput(args);
  if (!input) return formatModelHelp();

  const config = store.getConfig();
  const existed = config.models.some((model) => model.name === input.name);
  if (existed && !input.contextWindow) return `模型已存在: ${input.name}`;

  store.setConfig({ ...config, models: upsertModelConfig(config.models, input) });
  return existed ? `已更新模型: ${input.name}` : `已添加模型: ${input.name}`;
}

function removeModel(rawModel: string, store: ModelCommandStore): string {
  const model = rawModel.trim();
  if (!model) return formatModelHelp();

  const config = store.getConfig();
  if (model === config.model) return "不能移除当前模型，请先切换到其他模型";
  if (!config.models.some((item) => item.name === model)) return `模型不存在: ${model}`;

  store.setConfig({ ...config, models: config.models.filter((item) => item.name !== model) });
  return `已移除模型: ${model}`;
}

function parseModelInput(args: string[]): ModelInput | null {
  const parts = args.map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const contextWindow = parseContextWindow(parts.at(-1) ?? "");
  if (!contextWindow) return { name: parts.join(" ") };

  const name = parts.slice(0, -1).join(" ");
  return name ? { name, contextWindow } : null;
}

function upsertModelConfig(models: ModelConfig[], input: ModelInput): ModelConfig[] {
  const contextWindow = input.contextWindow ?? findModelContextWindow(models, input.name);
  const modelConfig = createModelConfig(input.name, contextWindow);
  return uniqueModelConfigs([modelConfig, ...models]);
}

function findModelContextWindow(models: ModelConfig[], name: string): number | undefined {
  return models.find((model) => model.name === name)?.contextWindow;
}

function uniqueModelConfigs(models: ModelConfig[]): ModelConfig[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.name)) return false;
    seen.add(model.name);
    return true;
  });
}

function formatModelList(config: AppConfig): string {
  const lines = [`当前模型: ${config.model}`, "", "可用模型:"];
  const models = uniqueModelConfigs([...config.models, createModelConfig(config.model)]);
  for (const model of models) {
    lines.push(`  ${model.name === config.model ? "*" : " "} ${formatModelConfig(model)}`);
  }
  lines.push("", "用法: /model <模型名> [上下文窗口] | /model add <模型名> [上下文窗口] | /model remove <模型名>");
  return lines.join("\n");
}

function formatModelConfig(model: ModelConfig): string {
  return `${model.name} (${formatContextWindow(model.contextWindow)})`;
}

function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1024 * 1024) return `${Number((contextWindow / 1024 / 1024).toFixed(1))}M`;
  if (contextWindow >= 1024) return `${Number((contextWindow / 1024).toFixed(1))}K`;
  return String(contextWindow);
}

function formatModelHelp(): string {
  return [
    "模型命令:",
    "  /model                 查看当前模型和模型列表",
    "  /model <模型名> [窗口]  切换模型，并自动加入模型列表",
    "  /model add <模型名> [窗口] 添加模型，可选窗口如 128K、1M、1048576",
    "  /model remove <模型名>  移除非当前模型",
  ].join("\n");
}
