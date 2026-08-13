import type { ChatMessage } from "../llm/types.js";
import { getMessages } from "./history.js";
import { expandInitCommandMessages } from "./initCommand.js";

export function buildMessages(systemPrompt: string): ChatMessage[] {
  return [{ role: "system", content: systemPrompt }, ...expandInitCommandMessages(getMessages())];
}
