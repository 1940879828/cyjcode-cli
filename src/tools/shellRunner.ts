import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

let sessionCwd: string | undefined;

export async function runShellCommand(options: ShellRunOptions): Promise<ShellRunResult> {
  const command = options.command.trim();
  const selectedShell = selectShell(options.shell ?? "auto");
  const resolvedShell = resolveShellPath(selectedShell);
  const timeoutMs = clampTimeout(options.timeoutMs);
  const startCwd = normalizeStartCwd();

  if (!resolvedShell) {
    return buildUnavailableResult(selectedShell, startCwd);
  }

  const marker = `__TIGACODE_CWD_${crypto.randomUUID()}__`;
  const spawned = spawn(resolvedShell, buildShellArgs(selectedShell, command, marker), {
    cwd: startCwd,
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  return await waitForProcess(spawned, {
    marker,
    timeoutMs,
    startCwd,
    shell: selectedShell,
    shellPath: resolvedShell,
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
  if (sessionCwd === undefined || !isInsideWorkspace(sessionCwd, workspaceRoot) || !fs.existsSync(sessionCwd)) {
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
  context: {
    marker: string;
    timeoutMs: number;
    startCwd: string;
    shell: Exclude<ShellKind, "auto">;
    shellPath: string;
  },
): Promise<ShellRunResult> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, context.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve(buildSpawnErrorResult(error, context));
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve(buildCompletedResult(output, exitCode, signal, timedOut, context));
    });
  });
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
  const forceKill = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already exited.
      }
    }
  }, 500);
  forceKill.unref();
}

function buildCompletedResult(
  rawOutput: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  timedOut: boolean,
  context: {
    marker: string;
    startCwd: string;
    shell: Exclude<ShellKind, "auto">;
    shellPath: string;
  },
): ShellRunResult {
  const extracted = extractCwd(rawOutput, context.marker);
  const nextCwd = extracted.cwd ?? context.startCwd;
  const workspaceRoot = process.cwd();
  const cwdReset = !isInsideWorkspace(nextCwd, workspaceRoot) || !fs.existsSync(nextCwd);
  sessionCwd = cwdReset ? workspaceRoot : nextCwd;
  const output = truncateOutput(extracted.output);
  return {
    success: !timedOut && exitCode === 0,
    output: output.text,
    exitCode,
    signal,
    timedOut,
    cwd: sessionCwd,
    startCwd: context.startCwd,
    shell: context.shell,
    shellPath: context.shellPath,
    truncated: output.truncated,
    cwdReset,
  };
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
  context: {
    startCwd: string;
    shell: Exclude<ShellKind, "auto">;
    shellPath: string;
  },
): ShellRunResult {
  return {
    success: false,
    output: "",
    exitCode: null,
    signal: null,
    timedOut: false,
    cwd: context.startCwd,
    startCwd: context.startCwd,
    shell: context.shell,
    shellPath: context.shellPath,
    truncated: false,
    cwdReset: false,
    error: error.message,
  };
}

function isInsideWorkspace(candidatePath: string, workspaceRoot: string): boolean {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedWorkspace, resolvedCandidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
