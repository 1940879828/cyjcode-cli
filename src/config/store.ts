import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { APP } from "./app.js";

// 旧配置目录名（迁移来源）
const LEGACY_DIR_NAME = ".cyjcode";

export interface AppConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  thinking: boolean;
  reasoningEffort: string;
}

const CONFIG_DIR = path.join(os.homedir(), APP.configDirName);
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const LEGACY_DIR = path.join(os.homedir(), LEGACY_DIR_NAME);

// ─── 默认值（唯一配置源） ──────────────────────────

export const DEFAULT_CONFIG: AppConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-v4-pro",
  models: [],
  thinking: true,
  reasoningEffort: "max",
};

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
}

// 检查是否有配置文件
export function hasConfig(): boolean {
  migrateLegacyConfig();
  return fs.existsSync(CONFIG_FILE);
}

// 读取配置文件
export function getConfig(): AppConfig {
  if (!hasConfig()) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw) as Partial<AppConfig>;
  return { ...DEFAULT_CONFIG, ...parsed };
}

// 写入配置文件
export function setConfig(config: AppConfig): void {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

// 读取路径
export function getConfigPath(): string {
  return CONFIG_FILE;
}

// 读取目录
export function getConfigDir(): string {
  return CONFIG_DIR;
}
