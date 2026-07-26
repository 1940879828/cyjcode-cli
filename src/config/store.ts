import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 配置文件结构
export interface CyjConfig {
  // API 基础路径
  baseUrl: string;
  // API 密钥
  apiKey: string;
  // 当前选中模型
  model: string;
  // 可用模型列表
  models: string[];
}

const CONFIG_DIR = path.join(os.homedir(), ".cyjcode");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// 配置持久化模块 
const DEFAULT_CONFIG: CyjConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  models: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
    "o3-mini",
  ],
};

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// 检查是否有配置文件
export function hasConfig(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

// 读取配置文件
export function getConfig(): CyjConfig {
  if (!hasConfig()) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
  const parsed = JSON.parse(raw) as Partial<CyjConfig>;
  return { ...DEFAULT_CONFIG, ...parsed };
}

// 写入配置文件
export function setConfig(config: CyjConfig): void {
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
