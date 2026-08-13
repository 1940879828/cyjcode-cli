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
    return (userMessage, options) => mockAgentLoop(userMessage, mockPath, options);
  }
  if (recordPath) {
    return (userMessage, options) => recordAgentLoop(userMessage, recordPath, options);
  }
  return runAgentLoop;
}
