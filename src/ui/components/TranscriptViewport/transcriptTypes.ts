import type { AssistantTurn } from "../../assistantTurn.js";
import type { ChatEntry } from "../../hooks/index.js";

export type TranscriptRowKind =
  | "header"
  | "spacer"
  | "system"
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "error";

export interface TranscriptRow {
  id: string;
  kind: TranscriptRowKind;
  text: string;
  segments?: TranscriptRowSegment[];
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dimColor?: boolean;
  /** 行在源文本中的出处；装饰行（header/分隔/hint）无 source */
  source?: TranscriptRowSource;
}

export interface TranscriptRowSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
}

/** 源文本单元：id 与行 source.sourceId 对应，text 为未经折行的原文 */
export interface TranscriptSourceUnit {
  id: string;
  text: string;
}

/** 源文本字符区间 + 行内装饰前缀；offset 为 JS 字符索引 */
export interface TranscriptRowSource {
  sourceId: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
}

export interface BuildTranscriptRowsInput {
  header?: TranscriptHeader;
  entries: readonly ChatEntry[];
  streamingReasoning: string;
  streamingAssistantTurn: AssistantTurn | null;
  width: number;
}

export interface TranscriptHeader {
  version: string;
  model: string;
  thinking: boolean;
  reasoningEffort: string;
  path: string;
}

/** 折行产物：text 为该物理行内容，offset 为该行在源文本中的字符区间 */
export interface WrappedLine {
  text: string;
  startOffset: number;
  endOffset: number;
}
