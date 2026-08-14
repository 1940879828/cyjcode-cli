import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "../config/store.js";
import type { ChatMessage } from "../llm/types.js";
import { readJsonFile, writeJsonFileAtomic } from "../utils/jsonFile.js";
import { FileHistoryStore } from "./fileHistoryStore.js";

export interface SessionInfo {
  id: string;
  title: string;
  workspaceRoot: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  archived?: boolean;
}

interface CurrentSessionFile {
  sessionId: string;
}

interface WorkspaceIndexEntry {
  workspaceRoot: string;
  workspaceKey: string;
  currentSessionId?: string;
  updatedAt: number;
}

interface SessionIndex {
  workspaces: Record<string, WorkspaceIndexEntry>;
}

const DEFAULT_INDEX: SessionIndex = { workspaces: {} };

export class SessionStore {
  constructor(private readonly baseDir = path.join(getConfigDir(), "sessions")) {}

  createSession(workspaceRoot = process.cwd()): SessionInfo {
    const info = createSessionInfo(workspaceRoot);
    writeJsonFileAtomic(this.sessionFile(workspaceRoot, info.id), info);
    createEmptyFile(this.messagesFile(workspaceRoot, info.id));
    this.setCurrentSession(workspaceRoot, info.id);
    return info;
  }

  getSession(sessionId: string, workspaceRoot = process.cwd()): SessionInfo | null {
    return readJsonFile<SessionInfo>(this.sessionFile(workspaceRoot, sessionId));
  }

  listSessions(workspaceRoot = process.cwd()): SessionInfo[] {
    const dir = this.workspaceDir(workspaceRoot);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.getSession(entry.name, workspaceRoot))
      .filter((item): item is SessionInfo => item !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  getCurrentSession(workspaceRoot = process.cwd()): SessionInfo | null {
    const current = readJsonFile<CurrentSessionFile>(this.currentFile(workspaceRoot));
    return current ? this.getSession(current.sessionId, workspaceRoot) : null;
  }

  setCurrentSession(workspaceRoot: string, sessionId: string): boolean {
    const info = this.getSession(sessionId, workspaceRoot);
    if (!info) return false;
    writeJsonFileAtomic(this.currentFile(workspaceRoot), { sessionId });
    this.updateIndex(workspaceRoot, sessionId);
    return true;
  }

  resolveContinueSession(workspaceRoot = process.cwd()): SessionInfo {
    return this.getCurrentSession(workspaceRoot) ?? this.createSession(workspaceRoot);
  }

  createHistoryStore(sessionId: string, workspaceRoot = process.cwd()): FileHistoryStore {
    const filePath = this.messagesFile(workspaceRoot, sessionId);
    return new FileHistoryStore(filePath, (messages) => this.updateSessionMessages(workspaceRoot, sessionId, messages));
  }

  workspaceKey(workspaceRoot = process.cwd()): string {
    return workspaceKey(workspaceRoot);
  }

  private updateSessionMessages(workspaceRoot: string, sessionId: string, messages: ChatMessage[]): void {
    const info = this.getSession(sessionId, workspaceRoot);
    if (!info) return;
    writeJsonFileAtomic(this.sessionFile(workspaceRoot, sessionId), updateSessionInfo(info, messages));
    this.updateIndex(workspaceRoot, sessionId);
  }

  private updateIndex(workspaceRoot: string, sessionId: string): void {
    const key = this.workspaceKey(workspaceRoot);
    const index = readJsonFile<SessionIndex>(this.indexFile()) ?? DEFAULT_INDEX;
    index.workspaces[key] = createIndexEntry(workspaceRoot, key, sessionId);
    writeJsonFileAtomic(this.indexFile(), index);
  }

  private sessionFile(workspaceRoot: string, sessionId: string): string {
    return path.join(this.workspaceDir(workspaceRoot), sessionId, "session.json");
  }

  private messagesFile(workspaceRoot: string, sessionId: string): string {
    return path.join(this.workspaceDir(workspaceRoot), sessionId, "messages.jsonl");
  }

  private currentFile(workspaceRoot: string): string {
    return path.join(this.workspaceDir(workspaceRoot), "current.json");
  }

  private workspaceDir(workspaceRoot: string): string {
    return path.join(this.baseDir, this.workspaceKey(workspaceRoot));
  }

  private indexFile(): string {
    return path.join(this.baseDir, "index.json");
  }
}

export const defaultSessionStore = new SessionStore();

function createSessionInfo(workspaceRoot: string): SessionInfo {
  const createdAt = Date.now();
  return {
    id: generateSessionId(),
    title: `New session - ${new Date(createdAt).toISOString()}`,
    workspaceRoot: normalizeWorkspaceIdentity(workspaceRoot),
    createdAt,
    updatedAt: createdAt,
    messageCount: 0,
  };
}

function updateSessionInfo(info: SessionInfo, messages: ChatMessage[]): SessionInfo {
  return {
    ...info,
    title: titleFromMessages(messages) ?? info.title,
    updatedAt: Date.now(),
    messageCount: messages.length,
  };
}

function titleFromMessages(messages: ChatMessage[]): string | null {
  const user = messages.find((message) => message.role === "user" && message.content);
  if (!user?.content) return null;
  return user.content.replace(/\s+/g, " ").trim().slice(0, 40);
}

function createIndexEntry(
  workspaceRoot: string,
  workspaceKeyValue: string,
  sessionId: string,
): WorkspaceIndexEntry {
  return {
    workspaceRoot: normalizeWorkspaceIdentity(workspaceRoot),
    workspaceKey: workspaceKeyValue,
    currentSessionId: sessionId,
    updatedAt: Date.now(),
  };
}

function createEmptyFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "", "utf-8");
}

function workspaceKey(workspaceRoot: string): string {
  const normalized = normalizeWorkspaceIdentity(workspaceRoot);
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function normalizeWorkspaceIdentity(workspaceRoot: string): string {
  const normalized = normalizeWorkspaceRoot(workspaceRoot);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot).replaceAll("\\", "/");
}

function generateSessionId(): string {
  return `ses_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}
