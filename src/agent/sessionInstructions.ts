import { addMessage, isHistoryEmpty } from "./history.js";
import { loadProjectInstructions } from "./projectInstructions.js";
import type { AgentHistoryStore } from "./runtime.js";

export function appendProjectInstructionsToHistory(
  startDir = process.cwd(),
  history: AgentHistoryStore | null = null,
): boolean {
  if (!isTargetHistoryEmpty(history)) return false;

  const instructions = loadProjectInstructions(startDir);
  if (!instructions) return false;

  if (history) {
    history.addMessage({ role: "system", content: instructions.content });
    return true;
  }
  addMessage({ role: "system", content: instructions.content });
  return true;
}

function isTargetHistoryEmpty(history: AgentHistoryStore | null): boolean {
  return history ? history.getLength() === 0 : isHistoryEmpty();
}
