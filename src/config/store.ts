import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { APP } from "./app.js";

// 旧配置目录名（迁移来源）
const LEGACY_DIR_NAME = ".cyjcode";

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const PROVIDERS = ["deepseek", "codebuddy"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: ModelConfig[];
  thinking: boolean;
  reasoningEffort: ReasoningEffort;
  provider: Provider;
}

export interface ModelConfig {
  name: string;
  contextWindow: number;
}

const CONFIG_DIR = path.join(os.homedir(), APP.configDirName);
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LEGACY_DIR = path.join(os.homedir(), LEGACY_DIR_NAME);
const PRIVATE_FILE_MODE = 0o600;
export const DEFAULT_CONTEXT_WINDOW = 256 * 1024;
export const DEEPSEEK_V4_CONTEXT_WINDOW = 1024 * 1024;
export const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  { name: "deepseek-v4-pro", contextWindow: DEEPSEEK_V4_CONTEXT_WINDOW },
  { name: "deepseek-v4-flash", contextWindow: DEEPSEEK_V4_CONTEXT_WINDOW },
];

// ─── 默认值（唯一配置源） ──────────────────────────

export const DEFAULT_CONFIG: AppConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-pro",
  models: DEFAULT_MODEL_CONFIGS,
  thinking: true,
  reasoningEffort: "high",
  provider: "deepseek",
};

/** CodeBuddy 官方端点（中国版，含 /v2 前缀，chat/completions 直接拼在后面） */
export const CODEBUDDY_BASE_URL = "https://copilot.tencent.com/v2";

/** API Key 以 ck_ 开头即视为 CodeBuddy 订阅密钥 */
export function detectProvider(apiKey: string): Provider {
  return apiKey.trimStart().startsWith("ck_") ? "codebuddy" : "deepseek";
}

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/** 从旧目录 ~/.cyjcode 迁移配置到新目录 ~/.tigacode（复制文件，不删旧数据） */
function migrateLegacyConfig(): void {
  if (fs.existsSync(CONFIG_DIR) || !fs.existsSync(LEGACY_DIR)) return;
  ensureDir();
  for (const entry of fs.readdirSync(LEGACY_DIR, { withFileTypes: true })) {
    const source = path.join(LEGACY_DIR, entry.name);
    const target = path.join(CONFIG_DIR, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(source, target, { recursive: true });
    } else {
      fs.copyFileSync(source, target);
    }
  }
  protectConfigFile();
}

// 检查是否有配置文件
export function hasConfig(): boolean {
  migrateLegacyConfig();
  return fs.existsSync(CONFIG_FILE);
}

// 读取配置文件
export function getConfig(): AppConfig {
  if (!hasConfig()) {
    return normalizeConfig(DEFAULT_CONFIG);
  }
  protectConfigFile();
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw) as RawAppConfig;
  return normalizeConfig({ ...DEFAULT_CONFIG, ...parsed });
}

// 写入配置文件
export function setConfig(config: AppConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalizeConfig(config), null, 2), {
    encoding: "utf-8",
    mode: PRIVATE_FILE_MODE,
  });
  protectConfigFile();
}

// 读取路径
export function getConfigPath(): string {
  return CONFIG_FILE;
}

// 读取目录
export function getConfigDir(): string {
  return CONFIG_DIR;
}

type RawAppConfig = Partial<Omit<AppConfig, "models">> & { models?: unknown };

export function createModelConfig(
  name: string,
  contextWindow = getDefaultContextWindow(name),
): ModelConfig {
  return { name: name.trim(), contextWindow };
}

export function getModelContextWindow(model: string, models: ModelConfig[]): number {
  const normalized = model.trim();
  return models.find((item) => item.name === normalized)?.contextWindow
    ?? getDefaultContextWindow(normalized);
}

export function parseContextWindow(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!match) return null;
  const scale = readContextWindowScale(match[2]);
  const tokens = Number(match[1]) * scale;
  return Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : null;
}

function normalizeConfig(config: RawAppConfig): AppConfig {
  const model = config.model || DEFAULT_CONFIG.model;
  const apiKey = config.apiKey ?? DEFAULT_CONFIG.apiKey;
  return {
    ...DEFAULT_CONFIG,
    ...config,
    model,
    apiKey,
    models: normalizeModelConfigs(config.models, model),
    reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
    provider: normalizeProvider(config.provider, apiKey),
  };
}

function normalizeProvider(provider: unknown, apiKey: string): Provider {
  if (typeof provider === "string" && (PROVIDERS as readonly string[]).includes(provider)) {
    return provider as Provider;
  }
  return detectProvider(apiKey);
}

function normalizeModelConfigs(models: unknown, currentModel: string): ModelConfig[] {
  const rawModels = Array.isArray(models) ? models : [];
  const modelConfigs = rawModels.map(readModelConfig).filter((item) => item !== null);
  return uniqueModelConfigs([...modelConfigs, createModelConfig(currentModel)]);
}

function readModelConfig(value: unknown): ModelConfig | null {
  if (typeof value === "string") return readModelNameConfig(value);
  if (!isRecord(value)) return null;

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  return createModelConfig(name, readContextWindow(value.contextWindow, name));
}

function readModelNameConfig(name: string): ModelConfig | null {
  const normalized = name.trim();
  return normalized ? createModelConfig(normalized) : null;
}

function readContextWindow(value: unknown, model: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  return typeof value === "string"
    ? parseContextWindow(value) ?? getDefaultContextWindow(model)
    : getDefaultContextWindow(model);
}

function getDefaultContextWindow(model: string): number {
  return DEFAULT_MODEL_CONFIGS.find((item) => item.name === model.trim())?.contextWindow
    ?? DEFAULT_CONTEXT_WINDOW;
}

function readContextWindowScale(unit: string | undefined): number {
  if (unit?.toLowerCase() === "m") return 1024 * 1024;
  if (unit?.toLowerCase() === "k") return 1024;
  return 1;
}

function normalizeReasoningEffort(effort: unknown): ReasoningEffort {
  return typeof effort === "string" && (REASONING_EFFORTS as readonly string[]).includes(effort)
    ? effort as ReasoningEffort
    : DEFAULT_CONFIG.reasoningEffort;
}

function uniqueModelConfigs(models: ModelConfig[]): ModelConfig[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.name)) return false;
    seen.add(model.name);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function protectConfigFile(): void {
  if (!fs.existsSync(CONFIG_FILE)) return;
  fs.chmodSync(CONFIG_FILE, PRIVATE_FILE_MODE);
}
