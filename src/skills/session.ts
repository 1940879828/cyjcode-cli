import type { ChatMessage } from "../llm/types.js";
import type { SkillInfo, SkillSessionSnapshot, SkillSessionState } from "./types.js";

export const AUTO_INJECT_THRESHOLD = 0.75;
export const SUGGEST_THRESHOLD = 0.45;

export interface SkillLoadResult {
  success: boolean;
  message: string;
  injection?: ChatMessage;
  skill?: SkillInfo;
}

export function createSkillSessionState(): SkillSessionState {
  return {
    loadedSkillNames: new Set<string>(),
    suggestedSkillNames: new Set<string>(),
    lastCandidates: [],
    manualSkillArgs: new Map<string, string>(),
  };
}

export function resetSkillSessionState(state: SkillSessionState): void {
  state.loadedSkillNames.clear();
  state.suggestedSkillNames.clear();
  state.lastCandidates = [];
  state.manualSkillArgs.clear();
}

export function snapshotSkillSessionState(state: SkillSessionState): SkillSessionSnapshot {
  return {
    loadedSkillNames: [...state.loadedSkillNames],
    suggestedSkillNames: [...state.suggestedSkillNames],
    lastCandidates: [...state.lastCandidates],
    manualSkillArgs: [...state.manualSkillArgs],
  };
}

export function restoreSkillSessionState(state: SkillSessionState, snapshot: SkillSessionSnapshot): void {
  state.loadedSkillNames = new Set(snapshot.loadedSkillNames);
  state.suggestedSkillNames = new Set(snapshot.suggestedSkillNames);
  state.lastCandidates = [...snapshot.lastCandidates];
  state.manualSkillArgs = new Map(snapshot.manualSkillArgs);
}
