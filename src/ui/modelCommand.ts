import { getConfig, setConfig } from "../config/store.js";
import type { AppConfig } from "../config/store.js";

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
  if (command === "use" || command === "switch") return switchModel(restArgs.join(" "), store);
  if (command === "add") return addModel(restArgs.join(" "), store);
  if (REMOVE_COMMANDS.has(command)) return removeModel(restArgs.join(" "), store);
  return switchModel(args.join(" "), store);
}

function switchModel(rawModel: string, store: ModelCommandStore): string {
  const model = rawModel.trim();
  if (!model) return formatModelHelp();

  const config = store.getConfig();
  store.setConfig({ ...config, model, models: uniqueModels([model, ...config.models]) });
  return `已切换模型: ${model}`;
}

function addModel(rawModel: string, store: ModelCommandStore): string {
  const model = rawModel.trim();
  if (!model) return formatModelHelp();

  const config = store.getConfig();
  if (config.models.includes(model)) return `模型已存在: ${model}`;

  store.setConfig({ ...config, models: uniqueModels([...config.models, model]) });
  return `已添加模型: ${model}`;
}

function removeModel(rawModel: string, store: ModelCommandStore): string {
  const model = rawModel.trim();
  if (!model) return formatModelHelp();

  const config = store.getConfig();
  if (model === config.model) return "不能移除当前模型，请先切换到其他模型";
  if (!config.models.includes(model)) return `模型不存在: ${model}`;

  store.setConfig({ ...config, models: config.models.filter((item) => item !== model) });
  return `已移除模型: ${model}`;
}

function formatModelList(config: AppConfig): string {
  const lines = [`当前模型: ${config.model}`, "", "可用模型:"];
  for (const model of uniqueModels([config.model, ...config.models])) {
    lines.push(`  ${model === config.model ? "*" : " "} ${model}`);
  }
  lines.push("", "用法: /model <模型名> | /model add <模型名> | /model remove <模型名>");
  return lines.join("\n");
}

function formatModelHelp(): string {
  return [
    "模型命令:",
    "  /model                 查看当前模型和模型列表",
    "  /model <模型名>        切换模型，并自动加入模型列表",
    "  /model add <模型名>    添加模型",
    "  /model remove <模型名> 移除非当前模型",
  ].join("\n");
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}
