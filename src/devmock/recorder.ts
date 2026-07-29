import fs from "node:fs/promises";
import path from "node:path";
import { runAgentLoop } from "../agent/loop.js";
import type { AgentEvent } from "../agent/types.js";
import type { RecordedEvent, SessionRecording } from "./types.js";

const MOCKDATA_DIR = path.resolve(process.cwd(), "mockdata");

// ─── 模块级录制状态 ──────────────────────────────────

let recordOutputPath: string | null = null;

/** 设置录制输出路径（相对于 mockdata/ 目录） */
export function setRecordPath(outputPath: string | null): void {
  recordOutputPath = outputPath;
}

/** 获取当前录制输出路径 */
export function getRecordPath(): string | null {
  return recordOutputPath;
}

// ─── 录制器 ──────────────────────────────────────────

class SessionRecorder {
  private events: RecordedEvent[] = [];
  private userMessage: string;
  private outputPath: string;

  constructor(userMessage: string, outputPath: string) {
    this.userMessage = userMessage;
    this.outputPath = outputPath;
  }

  record(event: AgentEvent): void {
    this.events.push({ timestamp: Date.now(), event });
  }

  async save(): Promise<void> {
    const fullPath = path.join(MOCKDATA_DIR, this.outputPath);
    const recording: SessionRecording = {
      version: 1,
      recordedAt: new Date().toISOString(),
      userMessage: this.userMessage,
      events: this.events,
    };

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(recording, null, 2), "utf-8");
  }
}

// ─── 录制包装器 ──────────────────────────────────────

/**
 * 包装 runAgentLoop，拦截所有事件并录制到文件。
 * 零侵入：完全不修改 loop.ts，仅在外层做事件拦截。
 */
export async function* recordAgentLoop(
  userMessage: string,
  outputPath: string,
): AsyncGenerator<AgentEvent> {
  const recorder = new SessionRecorder(userMessage, outputPath);

  for await (const event of runAgentLoop(userMessage)) {
    recorder.record(event);
    yield event;
  }

  await recorder.save();
}
