import type { ChatMessage } from "../llm/types.js";
import { createSkillManager, type SkillManager } from "../skills/index.js";
import { log } from "../utils/logger.js";
import {
  addMessage,
  getHistoryLength,
  getMessages,
  truncateHistory,
} from "./history.js";
import { buildSystemPrompt } from "./prompt.js";

export interface AgentHistoryStore {
  addMessage(message: ChatMessage): void;
  getMessages(): ChatMessage[];
  getLength(): number;
  truncate(length: number): void;
}

export interface AgentRuntime {
  history: AgentHistoryStore;
  workspaceRoot: string;
  log: typeof log;
  buildSystemPrompt: () => string;
  skillManager: SkillManager;
}

let defaultSkillManager = createSkillManager(process.cwd());

export const defaultHistoryStore: AgentHistoryStore = {
  addMessage,
  getMessages,
  getLength: getHistoryLength,
  truncate: truncateHistory,
};

export function createDefaultAgentRuntime(): AgentRuntime {
  const workspaceRoot = process.cwd();
  const skillManager = getDefaultSkillManager(workspaceRoot);
  return {
    history: defaultHistoryStore,
    workspaceRoot,
    log,
    buildSystemPrompt: () => buildSystemPrompt(workspaceRoot, skillManager.list()),
    skillManager,
  };
}

export function getDefaultSkillManager(workspaceRoot = process.cwd()): SkillManager {
  if (defaultSkillManager.workspaceRoot !== workspaceRoot) {
    defaultSkillManager = createSkillManager(workspaceRoot);
  }
  return defaultSkillManager;
}

export function resetDefaultSkillSessionState(): void {
  defaultSkillManager.reset();
}
