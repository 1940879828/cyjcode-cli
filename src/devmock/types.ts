import type { AgentEvent } from "../agent/types.js";

/**
 * 单条录制事件，携带时间戳和完整事件数据
 */
export interface RecordedEvent {
  /** 事件发生时间戳（毫秒） */
  timestamp: number;
  /** 事件数据 */
  event: AgentEvent;
}

/**
 * 一次完整会话的录制数据，保存为 mockdata/<name>.json
 */
export interface SessionRecording {
  /** 数据格式版本，用于后续兼容 */
  version: 1;
  /** 录制时间（ISO 8601） */
  recordedAt: string;
  /** 用户输入文本 */
  userMessage: string;
  /** 按时间顺序排列的所有事件 */
  events: RecordedEvent[];
}
