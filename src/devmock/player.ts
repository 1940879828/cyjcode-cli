import fs from "node:fs/promises";
import path from "node:path";
import type { AgentEvent } from "../agent/types.js";
import type { SessionRecording } from "./types.js";

const MOCKDATA_DIR = path.resolve(process.cwd(), "mockdata");

// ─── 模块级 mock 状态 ──────────────────────────────

let mockPath: string | null = null;

export function setMockPath(p: string | null): void {
  mockPath = p;
}

export function getMockPath(): string | null {
  return mockPath;
}

// ─── 辅助 ──────────────────────────────────────────

async function load(path: string): Promise<SessionRecording> {
  const raw = await fs.readFile(path, "utf-8");
  return JSON.parse(raw) as SessionRecording;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ─── 回放器 ────────────────────────────────────────

/**
 * mockAgentLoop：读取录制文件并按原始时间间隔回放事件。
 * userMessage 在 mock 模式下被忽略。
 */
export async function* mockAgentLoop(
  _userMessage: string,
  fileName: string,
): AsyncGenerator<AgentEvent> {
  const recording = await load(path.join(MOCKDATA_DIR, fileName));
  const events = recording.events;

  if (events.length === 0) return;

  for (let i = 0; i < events.length; i++) {
    if (i > 0) {
      const delta = events[i].timestamp - events[i - 1].timestamp;
      if (delta > 0) await sleep(Math.min(delta, 500));
    }
    yield events[i].event;
  }
}
