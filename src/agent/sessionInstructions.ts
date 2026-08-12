import { addMessage, isHistoryEmpty } from "./history.js";
import { loadProjectInstructions } from "./projectInstructions.js";

export function appendProjectInstructionsToHistory(startDir = process.cwd()): boolean {
  if (!isHistoryEmpty()) return false;

  const instructions = loadProjectInstructions(startDir);
  if (!instructions) return false;

  addMessage({ role: "system", content: instructions.content });
  return true;
}
