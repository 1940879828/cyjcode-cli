import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "../llm/types.js";
import { readJsonFile } from "../utils/jsonFile.js";
import type { AgentHistoryStore } from "./runtime.js";

export type HistoryChangeHandler = (messages: ChatMessage[]) => void;

type HistoryRecord =
  | { type: "message"; message: ChatMessage }
  | { type: "truncate"; length: number };

export class FileHistoryStore implements AgentHistoryStore {
  private messages: ChatMessage[];

  constructor(
    private readonly filePath: string,
    private readonly onChange: HistoryChangeHandler = () => {},
  ) {
    this.messages = readMessages(filePath);
    ensureHistoryFile(filePath, this.messages);
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.append({ type: "message", message });
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getLength(): number {
    return this.messages.length;
  }

  truncate(length: number): void {
    const nextLength = Math.max(0, Math.min(length, this.messages.length));
    if (nextLength === this.messages.length) return;
    this.messages.length = nextLength;
    this.append({ type: "truncate", length: nextLength });
  }

  private append(record: HistoryRecord): void {
    appendHistoryRecord(this.filePath, record);
    this.onChange(this.getMessages());
  }
}

function readMessages(filePath: string): ChatMessage[] {
  return replayHistory(readJsonlRecords(filePath, legacyFilePath(filePath)));
}

function ensureHistoryFile(filePath: string, messages: ChatMessage[] = []): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, messages.map(messageRecordLine).join(""), "utf-8");
}

function appendHistoryRecord(filePath: string, record: HistoryRecord): void {
  ensureHistoryFile(filePath);
  fs.appendFileSync(filePath, recordLine(record), "utf-8");
}

function readJsonlRecords(filePath: string, legacyPath: string): HistoryRecord[] {
  if (!fs.existsSync(filePath)) return readLegacyRecords(legacyPath);
  return fs.readFileSync(filePath, "utf-8")
    .split(/\r?\n/)
    .flatMap(parseRecordLine);
}

function readLegacyRecords(filePath: string): HistoryRecord[] {
  const parsed = readJsonFile<unknown>(filePath);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isChatMessage).map((message) => ({ type: "message", message }));
}

function parseRecordLine(line: string): HistoryRecord[] {
  if (!line.trim()) return [];
  try {
    const record = JSON.parse(line) as unknown;
    return isHistoryRecord(record) ? [record] : [];
  } catch {
    return [];
  }
}

function replayHistory(records: HistoryRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const record of records) applyHistoryRecord(messages, record);
  return messages;
}

function applyHistoryRecord(messages: ChatMessage[], record: HistoryRecord): void {
  if (record.type === "message") {
    messages.push(record.message);
    return;
  }
  messages.length = Math.max(0, Math.min(record.length, messages.length));
}

function messageRecordLine(message: ChatMessage): string {
  return recordLine({ type: "message", message });
}

function recordLine(record: HistoryRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as { type?: unknown; message?: unknown; length?: unknown };
  if (record.type === "message") return isChatMessage(record.message);
  return record.type === "truncate" && Number.isInteger(record.length);
}

function legacyFilePath(filePath: string): string {
  return filePath.endsWith(".jsonl") ? filePath.slice(0, -1) : `${filePath}.json`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const role = (value as { role?: unknown }).role;
  return role === "system" || role === "user" || role === "assistant" || role === "tool";
}
