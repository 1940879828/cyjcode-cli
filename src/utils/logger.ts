import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "../config/store.js";

export type LogEventType =
  | "session.start"
  | "session.end"
  | "llm.request"
  | "llm.response"
  | "tool.start"
  | "tool.end"
  | "error";

export interface LogEntry {
  timestamp: string;
  type: LogEventType;
  data: Record<string, unknown>;
}

const LOGS_DIR = path.join(getConfigDir(), "logs");

function getLogFilePath(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return path.join(LOGS_DIR, `${dateStr}.jsonl`);
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * 写入一条 JSONL 日志记录
 */
export function log(type: LogEventType, data: Record<string, unknown> = {}): void {
  ensureLogDir();
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    type,
    data,
  };
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(getLogFilePath(), line, "utf-8");
}

/**
 * 获取当日的日志文件路径
 */
export function getTodayLogPath(): string {
  ensureLogDir();
  return getLogFilePath();
}

/**
 * 获取所有日志文件列表（按日期倒序）
 */
export function getLogFiles(): string[] {
  ensureLogDir();
  try {
    return fs
      .readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * 读取指定日志文件的行
 */
export function readLogLines(fileName: string, offset: number = 0): string[] {
  const filePath = path.join(LOGS_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.slice(offset);
}
