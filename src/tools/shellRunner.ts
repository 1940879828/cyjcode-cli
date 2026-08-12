import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isInsideWorkspace } from "./workspacePath.js";

export type ShellKind = "auto" | "powershell" | "bash";

export interface ShellRunOptions {
  command: string;
  timeoutMs?: number;
  shell?: ShellKind;
}

export interface ShellRunResult {
  success: boolean;
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cwd: string;
  startCwd: string;
  shell: Exclude<ShellKind, "auto">;
  shellPath: string;
  truncated: boolean;
  cwdReset: boolean;
  error?: string;
}

interface ShellProcessContext {
  marker: string;
  timeoutMs: number;
  startCwd: string;
  shell: Exclude<ShellKind, "auto">;
  shellPath: string;
}

interface CompletedResultInput {
  rawOutput: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  context: ShellProcessContext;
}

interface ProcessWaitState {
  output: string;
  timedOut: boolean;
  timeout?: NodeJS.Timeout;
}

interface CompletedProcessInput {
  context: ShellProcessContext;
  state: ProcessWaitState;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

interface SpawnShellInput {
  shellPath: string;
  shell: Exclude<ShellKind, "auto">;
  command: string;
  marker: string;
  cwd: string;
}

interface ShellExecution {
  command: string;
  shell: Exclude<ShellKind, "auto">;
  shellPath: string;
  timeoutMs: number;
  startCwd: string;
  marker: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

let sessionCwd: string | undefined;

export async function runShellCommand(options: ShellRunOptions): Promise<ShellRunResult> {
  const execution = prepareShellExecution(options);

  if (!execution.shellPath) return buildUnavailableResult(execution.shell, execution.startCwd);

  const spawned = spawnShellProcess(buildSpawnInput(execution));

  return await waitForProcess(spawned, {
    marker: execution.marker,
    timeoutMs: execution.timeoutMs,
    startCwd: execution.startCwd,
    shell: execution.shell,
    shellPath: execution.shellPath,
  });
}

function prepareShellExecution(options: ShellRunOptions): ShellExecution {
  const shell = selectShell(options.shell ?? "auto");
  return {
    command: options.command.trim(),
    shell,
    shellPath: resolveShellPath(shell) ?? "",
    timeoutMs: clampTimeout(options.timeoutMs),
    startCwd: normalizeStartCwd(),
    marker: `__TIGACODE_CWD_${crypto.randomUUID()}__`,
  };
}

function buildSpawnInput(execution: ShellExecution): SpawnShellInput {
  return {
    shellPath: execution.shellPath,
    shell: execution.shell,
    command: execution.command,
    marker: execution.marker,
    cwd: execution.startCwd,
  };
}

function spawnShellProcess(input: SpawnShellInput): ReturnType<typeof spawn> {
  return spawn(input.shellPath, buildShellArgs(input.shell, input.command, input.marker), {
    cwd: input.cwd,
    windowsHide: true,
    detached: process.platform !== "win32",
  });
}

function selectShell(shell: ShellKind): Exclude<ShellKind, "auto"> {
  if (shell === "auto") {
    return process.platform === "win32" ? "powershell" : "bash";
  }
  return shell;
}

function normalizeStartCwd(): string {
  const workspaceRoot = process.cwd();
  if (
    sessionCwd === undefined ||
    !isInsideWorkspace(sessionCwd, workspaceRoot) ||
    !fs.existsSync(sessionCwd)
  ) {
    sessionCwd = workspaceRoot;
  }
  return sessionCwd;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(1, Math.trunc(timeoutMs)), MAX_TIMEOUT_MS);
}

function resolveShellPath(shell: Exclude<ShellKind, "auto">): string | undefined {
  return shell === "powershell" ? resolvePowerShellPath() : resolveBashPath();
}

function resolvePowerShellPath(): string | undefined {
  return findExecutable(["pwsh", "powershell"]);
}

function resolveBashPath(): string | undefined {
  if (process.platform !== "win32") {
    return findExecutable([process.env.SHELL, "/bin/bash", "/usr/bin/bash", "bash"]);
  }
  return findExecutable([
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    "bash",
  ]);
}

function findExecutable(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates.filter(isNonEmptyString)) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate;
    }
    const pathMatch = findOnPath(candidate);
    if (pathMatch !== undefined) {
      return pathMatch;
    }
  }
  return undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function findOnPath(command: string): string | undefined {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const pathEntry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(pathEntry, process.platform === "win32" ? `${command}${extension}` : command);
      if (fs.existsSync(candidate) && !isWindowsWslBash(command, candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isWindowsWslBash(command: string, candidate: string): boolean {
  return (
    process.platform === "win32" &&
    command.toLowerCase() === "bash" &&
    path.normalize(candidate).toLowerCase().endsWith("\\windows\\system32\\bash.exe")
  );
}

function buildShellArgs(shell: Exclude<ShellKind, "auto">, command: string, marker: string): string[] {
  if (shell === "powershell") {
    return ["-NoProfile", "-NonInteractive", "-Command", buildPowerShellScript(command, marker)];
  }
  return ["-lc", buildBashScript(command, marker)];
}

function buildPowerShellScript(command: string, marker: string): string {
  return [
    "$__tigacode_status = 0",
    "try {",
    `  & { ${command} }`,
    "  if ($LASTEXITCODE -ne $null) { $__tigacode_status = $LASTEXITCODE } elseif (-not $?) { $__tigacode_status = 1 }",
    "} catch {",
    "  Write-Error $_",
    "  $__tigacode_status = 1",
    "}",
    `Write-Output "${marker}$((Get-Location).Path)"`,
    "exit $__tigacode_status",
  ].join("\n");
}

function buildBashScript(command: string, marker: string): string {
  return [
    `trap '__tigacode_status=$?; printf "\\n%s%s\\n" "${marker}" "$PWD"; exit $__tigacode_status' EXIT`,
    "{",
    command,
    "}",
  ].join("\n");
}

function waitForProcess(
  child: ReturnType<typeof spawn>,
  context: ShellProcessContext,
): Promise<ShellRunResult> {
  return new Promise((resolve) => {
    const state = createWaitState(child, context.timeoutMs);
    attachOutputListeners(child, state);
    attachCompletionListeners({ child, context, state, resolve });
  });
}

function createWaitState(child: ReturnType<typeof spawn>, timeoutMs: number): ProcessWaitState {
  const state: ProcessWaitState = { output: "", timedOut: false };
  state.timeout = startProcessTimeout(child, timeoutMs, () => {
    state.timedOut = true;
  });
  return state;
}

function attachOutputListeners(child: ReturnType<typeof spawn>, state: ProcessWaitState): void {
  const appendOutput = (chunk: Buffer): void => {
    state.output += chunk.toString("utf-8");
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);
}

function attachCompletionListeners(input: {
  child: ReturnType<typeof spawn>;
  context: ShellProcessContext;
  state: ProcessWaitState;
  resolve: (result: ShellRunResult) => void;
}): void {
  input.child.on("error", (error) => {
    clearProcessTimeout(input.state);
    input.resolve(buildSpawnErrorResult(error, input.context));
  });
  input.child.on("close", (exitCode, signal) => {
    clearProcessTimeout(input.state);
    input.resolve(buildCompletedProcessResult({ context: input.context, state: input.state, exitCode, signal }));
  });
}

function clearProcessTimeout(state: ProcessWaitState): void {
  if (state.timeout) clearTimeout(state.timeout);
}

function buildCompletedProcessResult(input: CompletedProcessInput): ShellRunResult {
  return buildCompletedResult({
    rawOutput: input.state.output,
    exitCode: input.exitCode,
    signal: input.signal,
    timedOut: input.state.timedOut,
    context: input.context,
  });
}

function startProcessTimeout(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
  markTimedOut: () => void,
): NodeJS.Timeout {
  return setTimeout(() => {
    markTimedOut();
    killProcessTree(child.pid);
  }, timeoutMs);
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    killWindowsProcessTree(pid);
    return;
  }
  killPosixProcessTree(pid);
}

function killWindowsProcessTree(pid: number): void {
  spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

function killPosixProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const forceKill = setTimeout(() => forceKillPosixProcessTree(pid), 500);
  forceKill.unref();
}

function forceKillPosixProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    tryKillProcess(pid, "SIGKILL");
  }
}

function tryKillProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

function buildCompletedResult(input: CompletedResultInput): ShellRunResult {
  const extracted = extractCwd(input.rawOutput, input.context.marker);
  const cwdState = updateSessionCwd(extracted.cwd, input.context.startCwd);
  const output = truncateOutput(extracted.output);
  return {
    success: !input.timedOut && input.exitCode === 0,
    output: output.text,
    exitCode: input.exitCode,
    signal: input.signal,
    timedOut: input.timedOut,
    cwd: cwdState.cwd,
    startCwd: input.context.startCwd,
    shell: input.context.shell,
    shellPath: input.context.shellPath,
    truncated: output.truncated,
    cwdReset: cwdState.reset,
  };
}

function updateSessionCwd(cwd: string | undefined, startCwd: string): { cwd: string; reset: boolean } {
  const nextCwd = cwd ?? startCwd;
  const workspaceRoot = process.cwd();
  const reset = !isInsideWorkspace(nextCwd, workspaceRoot) || !fs.existsSync(nextCwd);
  sessionCwd = reset ? workspaceRoot : nextCwd;
  return { cwd: sessionCwd, reset };
}

function extractCwd(output: string, marker: string): { output: string; cwd?: string } {
  const pattern = new RegExp(`\\r?\\n?${escapeRegExp(marker)}([^\\r\\n]*)\\r?\\n?`);
  const match = pattern.exec(output);
  if (!match) {
    return { output };
  }
  return {
    output: output.slice(0, match.index) + output.slice(match.index + match[0].length),
    cwd: match[1],
  };
}

function truncateOutput(output: string): { text: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return { text: output, truncated: false };
  }
  return {
    text: `${output.slice(0, MAX_OUTPUT_CHARS)}\n... 输出已截断，最多返回 ${MAX_OUTPUT_CHARS} 字符`,
    truncated: true,
  };
}

function buildUnavailableResult(shell: Exclude<ShellKind, "auto">, startCwd: string): ShellRunResult {
  return {
    success: false,
    output: "",
    exitCode: null,
    signal: null,
    timedOut: false,
    cwd: startCwd,
    startCwd,
    shell,
    shellPath: "",
    truncated: false,
    cwdReset: false,
    error: `找不到可用的 ${shell} shell`,
  };
}

function buildSpawnErrorResult(
  error: Error,
  context: ShellProcessContext,
): ShellRunResult {
  return withShellContext(context, {
    success: false,
    output: "",
    exitCode: null,
    signal: null,
    timedOut: false,
    truncated: false,
    cwdReset: false,
    error: error.message,
  });
}

function withShellContext(
  context: ShellProcessContext,
  result: Omit<ShellRunResult, "cwd" | "startCwd" | "shell" | "shellPath">,
): ShellRunResult {
  return {
    ...result,
    cwd: context.startCwd,
    startCwd: context.startCwd,
    shell: context.shell,
    shellPath: context.shellPath,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
