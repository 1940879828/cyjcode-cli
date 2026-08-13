import { spawn } from "node:child_process";

const OSC52_TERMINATOR = "\x1b\\";
const MAX_POWERSHELL_BASE64_LENGTH = 100_000;

// 复制策略：TTY 下写 OSC52（终端支持时最可靠）；Windows 额外走 Set-Clipboard 兜底，
// 非 TTY（如 -p 执行模式）走平台命令。失败写 stderr，不静默。
export function copyTextToClipboard(text: string): void {
  if (!text) return;
  if (process.stdout.isTTY) writeOsc52(text);
  if (process.platform === "win32") writeViaPowershell(text);
  else if (!process.stdout.isTTY) writeViaPlatformCommand(text);
}

function writeOsc52(text: string): void {
  const payload = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\x1b]52;c;${payload}${OSC52_TERMINATOR}`);
}

function writeViaPowershell(text: string): void {
  const base64 = Buffer.from(text, "utf8").toString("base64");
  if (base64.length > MAX_POWERSHELL_BASE64_LENGTH) {
    writeClipboardWarning("选中内容过大，跳过系统剪贴板兜底");
    return;
  }
  runCopyProcess("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    buildSetClipboardCommand(base64),
  ]);
}

// 经 base64 传参，避免 stdin 控制台编码问题（PowerShell 5.1 默认非 UTF-8）
const buildSetClipboardCommand = (base64: string): string =>
  `Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${base64}')))`;

function writeViaPlatformCommand(text: string): void {
  const platformCommand = getPlatformCopyCommand();
  if (!platformCommand) return;
  runCopyProcess(platformCommand[0], platformCommand[1], text);
}

const getPlatformCopyCommand = (): [string, string[]] | null => {
  if (process.platform === "darwin") return ["pbcopy", []];
  if (process.platform === "linux") {
    return process.env.WAYLAND_DISPLAY ? ["wl-copy", []] : ["xclip", ["-selection", "clipboard"]];
  }
  return null;
};

function runCopyProcess(command: string, args: string[], stdinText?: string): void {
  const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  if (stdinText !== undefined) child.stdin.end(stdinText);
  child.on("error", () => writeClipboardWarning(`无法启动 ${command}`));
  child.on("close", (code) => {
    if (code !== 0) writeClipboardWarning(`${command} 退出码 ${code}`);
  });
}

function writeClipboardWarning(detail: string): void {
  process.stderr.write(`[tigacode] 复制到剪贴板失败：${detail}\n`);
}
