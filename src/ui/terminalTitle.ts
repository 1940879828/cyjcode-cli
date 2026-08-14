const BEL = "\u0007";
const OSC_SET_TITLE_AND_ICON = "\u001B]0;";

export const TERMINAL_TITLE_DISABLE_ENV = "TIGACODE_DISABLE_TERMINAL_TITLE";

export function isTerminalTitleDisabled(): boolean {
  return isEnvTruthy(process.env[TERMINAL_TITLE_DISABLE_ENV]);
}

export function setTerminalTitle(title: string): void {
  const cleanTitle = sanitizeTerminalTitle(title);
  if (process.platform === "win32") {
    process.title = cleanTitle;
    return;
  }
  writeTerminalTitle(cleanTitle);
}

export function clearTerminalTitle(): void {
  setTerminalTitle("");
}

function writeTerminalTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`${OSC_SET_TITLE_AND_ICON}${title}${BEL}`);
}

function sanitizeTerminalTitle(title: string): string {
  return stripAnsi(title)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g,
    "",
  );
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
