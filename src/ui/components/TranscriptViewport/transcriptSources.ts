import type { AssistantTurn } from "../../assistantTurn.js";
import type { ChatEntry } from "../../hooks/index.js";
import type { TranscriptSourceUnit } from "./transcriptTypes.js";

/** 源文本单元枚举，顺序与行构建一致；选中与复制都以它为基准 */
export const buildTranscriptSources = (
  input: {
    entries: readonly ChatEntry[];
    streamingReasoning: string;
    streamingAssistantTurn: AssistantTurn | null;
  },
): TranscriptSourceUnit[] => {
  const sources: TranscriptSourceUnit[] = [];
  for (const entry of input.entries) {
    appendEntrySources(sources, entry);
  }
  if (input.streamingReasoning) {
    sources.push({ id: "streaming_reasoning", text: input.streamingReasoning });
  }
  if (input.streamingAssistantTurn) {
    appendTurnSources(sources, input.streamingAssistantTurn);
  }
  return sources;
};

const appendEntrySources = (sources: TranscriptSourceUnit[], entry: ChatEntry) => {
  if (entry.role === "assistant") {
    appendTurnSources(sources, entry);
    return;
  }
  sources.push({ id: entry.id, text: entry.content });
};

const appendTurnSources = (sources: TranscriptSourceUnit[], turn: AssistantTurn) => {
  for (const part of turn.parts) {
    sources.push({ id: part.id, text: part.content });
  }
  if (turn.activeText) {
    sources.push({ id: `${turn.id}_active`, text: turn.activeText });
  }
};
