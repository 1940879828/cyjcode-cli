import { runAgentLoop } from "../agent/loop.js";
import type { AgentRunner } from "../ui/hooks/index.js";
import { mockAgentLoop } from "./player.js";
import { recordAgentLoop } from "./recorder.js";

export interface DevmockRunnerOptions {
  recordPath?: string;
  mockPath?: string;
}

export function createDevmockAgentRunner({
  recordPath,
  mockPath,
}: DevmockRunnerOptions): AgentRunner {
  if (mockPath) {
    return (userMessage) => mockAgentLoop(userMessage, mockPath);
  }
  if (recordPath) {
    return (userMessage) => recordAgentLoop(userMessage, recordPath);
  }
  return runAgentLoop;
}
