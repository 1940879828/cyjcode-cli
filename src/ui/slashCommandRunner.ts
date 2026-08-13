import { parseSlashInput } from "./commands.js";

export interface SlashCommandHandlers {
  appendSystemMessage: (content: string) => void;
  clearChat: () => void;
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
    void handlers.sendMessage(parsed.command.name);
    return;
  }

  handlers.appendSystemMessage(parsed.command.handler(parsed.args, {
    clearChat: handlers.clearChat,
    startSetup: handlers.startSetup,
  }));
}
