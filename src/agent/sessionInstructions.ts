import { loadProjectInstructions } from "./projectInstructions.js";
import type { AgentHistoryStore } from "./runtime.js";

export function appendProjectInstructionsToHistory(
  startDir: string,
  history: AgentHistoryStore,
): boolean {
  if (history.getLength() !== 0) return false;

  const instructions = loadProjectInstructions(startDir);
  if (!instructions) return false;

  history.addMessage({ role: "system", content: instructions.content });
  return true;
}
