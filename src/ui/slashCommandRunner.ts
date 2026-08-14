import { parseSlashInput, type SlashCommandContext } from "./commands.js";

export interface SlashCommandHandlers {
  appendSystemMessage: (content: string) => void;
  clearChat: () => void;
  newSession: () => string;
  listSessions: () => string;
  resumeSession: (sessionId: string) => string;
  sendMessage: (text: string) => Promise<void>;
  startSetup: () => void;
}

export function handleSlashCommand(
  commandText: string,
  handlers: SlashCommandHandlers,
): void {
  const parsed = parseSlashInput(commandText);
  if (!parsed) {
    handlers.appendSystemMessage(`未知命令: ${commandText}\n输入 /help 查看可用命令`);
    return;
  }

  if (parsed.command.execution === "agent") {
    void handlers.sendMessage(commandText.trim());
    return;
  }

  handlers.appendSystemMessage(parsed.command.handler(parsed.args, createSlashCommandContext(handlers)));
}

function createSlashCommandContext(handlers: SlashCommandHandlers): SlashCommandContext {
  return {
    clearChat: handlers.clearChat,
    newSession: handlers.newSession,
    listSessions: handlers.listSessions,
    resumeSession: handlers.resumeSession,
    startSetup: handlers.startSetup,
  };
}
