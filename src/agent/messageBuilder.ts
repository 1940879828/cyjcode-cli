import type { ChatMessage } from "../llm/types.js";
import { expandInitCommandMessages } from "./initCommand.js";

export function buildMessages(
  systemPrompt: string,
  historyMessages: ChatMessage[],
): ChatMessage[] {
  return [{ role: "system", content: systemPrompt }, ...expandInitCommandMessages(historyMessages)];
}
