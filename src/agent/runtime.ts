import type { ChatMessage } from "../llm/types.js";
import { createSkillManager, type SkillManager } from "../skills/index.js";
import { log } from "../utils/logger.js";
import { createObservationStore, type ObservationStore } from "./observationStore.js";
import { buildSystemPrompt } from "./prompt.js";
import { defaultSessionStore, type SessionInfo } from "./sessionStore.js";

export interface AgentHistoryStore {
  addMessage(message: ChatMessage): void;
  getMessages(): ChatMessage[];
  getLength(): number;
  truncate(length: number): void;
}

export interface AgentRuntime {
  history: AgentHistoryStore;
  sessionId: string;
  workspaceRoot: string;
  log: typeof log;
  buildSystemPrompt: () => string;
  skillManager: SkillManager;
  observationStore: ObservationStore;
}

export interface DefaultAgentRuntimeOptions {
  sessionId?: string;
  workspaceRoot?: string;
}

let defaultSkillManager = createSkillManager(process.cwd());

let transientSessionCounter = 0;

export function createDefaultAgentRuntime(options: DefaultAgentRuntimeOptions = {}): AgentRuntime {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const session = resolveRuntimeSession(workspaceRoot, options.sessionId);
  const skillManager = getDefaultSkillManager(workspaceRoot);
  return {
    history: defaultSessionStore.createHistoryStore(session.id, workspaceRoot),
    sessionId: session.id,
    workspaceRoot,
    log,
    buildSystemPrompt: () => buildSystemPrompt(workspaceRoot, skillManager.list()),
    skillManager,
    observationStore: createObservationStore(),
  };
}

export function createTransientAgentRuntime(workspaceRoot = process.cwd()): AgentRuntime {
  const skillManager = getDefaultSkillManager(workspaceRoot);
  return {
    history: createMemoryHistoryStore(),
    sessionId: `devmock_${++transientSessionCounter}`,
    workspaceRoot,
    log,
    buildSystemPrompt: () => buildSystemPrompt(workspaceRoot, skillManager.list()),
    skillManager,
    observationStore: createObservationStore(),
  };
}

export function createMemoryHistoryStore(messages: ChatMessage[] = []): AgentHistoryStore {
  return {
    addMessage: (message) => messages.push(message),
    getMessages: () => [...messages],
    getLength: () => messages.length,
    truncate: (length) => {
      messages.length = Math.max(0, Math.min(length, messages.length));
    },
  };
}

function resolveRuntimeSession(workspaceRoot: string, sessionId: string | undefined): SessionInfo {
  if (!sessionId) return defaultSessionStore.createSession(workspaceRoot);
  const session = defaultSessionStore.getSession(sessionId, workspaceRoot);
  if (session) return session;
  throw new Error(`会话不存在: ${sessionId}`);
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
