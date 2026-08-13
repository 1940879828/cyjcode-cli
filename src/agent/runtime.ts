import type { ChatMessage } from "../llm/types.js";
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
}

export const defaultHistoryStore: AgentHistoryStore = {
  addMessage,
  getMessages,
  getLength: getHistoryLength,
  truncate: truncateHistory,
};

export function createDefaultAgentRuntime(): AgentRuntime {
  const workspaceRoot = process.cwd();
  return {
    history: defaultHistoryStore,
    workspaceRoot,
    log,
    buildSystemPrompt: () => buildSystemPrompt(workspaceRoot),
  };
}
