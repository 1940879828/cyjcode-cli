import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "./defineTool.js";
import type { ToolResult } from "./types.js";
import { isInsideWorkspace } from "./workspacePath.js";

interface GitRunResult {
  success: boolean;
  output: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
}

interface GitProcess {
  child: ReturnType<typeof spawn>;
  args: string[];
  state: { output: string; timedOut: boolean };
  timeout: NodeJS.Timeout;
}

interface CompletedGitProcess {
  args: string[];
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

interface GitCloseEvent {
  gitProcess: GitProcess;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  resolve: (result: GitRunResult) => void;
}

const MAX_OUTPUT_CHARS = 30_000;
const GIT_TIMEOUT_MS = 120_000;

const optionalNumber = () => z.preprocess(
  (value) => (typeof value === "number" ? value : undefined),
  z.number().optional(),
);

const pathspecsSchema = z.array(z.string().min(1, "pathspec 不能为空")).optional()
  .describe("限制到指定文件或目录。每个路径会作为 git pathspec 传入，不拼 shell 命令。");

const gitStatus = defineTool({
  name: "git_status",
  description: "结构化查看 Git 工作区状态。等价于安全的 git status，默认短格式并显示分支。",
  schema: z.object({
    format: z.enum(["short", "long"]).optional().describe("输出格式，默认 short"),
    untracked: z.enum(["normal", "all", "none"]).optional().describe("未跟踪文件显示方式，默认 normal"),
  }),
  async execute(args): Promise<ToolResult> {
    const gitArgs = ["status", "--branch", untrackedArg(args.untracked)];
    if (args.format !== "long") gitArgs.splice(1, 0, "--short");
    return formatGitResult(await runGit(gitArgs), "git_status");
  },
});

const gitDiff = defineTool({
  name: "git_diff",
  description: "结构化查看 Git diff。支持 unstaged、staged、all 三种范围，可限制 pathspec。",
  schema: z.object({
    mode: z.enum(["unstaged", "staged", "all"]).optional().describe("diff 范围，默认 unstaged"),
    stat: z.boolean().optional().describe("只输出统计信息"),
    contextLines: optionalNumber().describe("统一 diff 上下文行数"),
    pathspecs: pathspecsSchema,
  }),
  async execute(args): Promise<ToolResult> {
    const validation = validatePathspecs(args.pathspecs);
    if (!validation.success) return validation;
    return formatGitResult(await runGit(buildDiffArgs(args)), "git_diff");
  },
});

const gitLog = defineTool({
  name: "git_log",
  description: "结构化查看 Git 提交历史。默认返回最近 10 条 oneline 记录。",
  schema: z.object({
    limit: optionalNumber().describe("最多返回多少条提交，默认 10，最大 100"),
    ref: z.string().min(1).optional().describe("可选 ref，例如 HEAD、main 或 origin/main"),
    format: z.enum(["oneline", "medium"]).optional().describe("输出格式，默认 oneline"),
    pathspecs: pathspecsSchema,
  }),
  async execute(args): Promise<ToolResult> {
    const validation = validateLogInput(args.ref, args.pathspecs);
    if (!validation.success) return validation;
    return formatGitResult(await runGit(buildLogArgs(args)), "git_log");
  },
});

const gitCommit = defineTool({
  name: "git_commit",
  description: "结构化创建 Git commit。可选择提交已暂存内容、先 stage 全部变更，或只 stage 指定 pathspec。",
  schema: z.object({
    message: z.string().min(1, "commit message 不能为空").describe("commit 标题"),
    body: z.string().optional().describe("可选 commit 正文"),
    stage: z.enum(["staged", "all", "paths"]).optional().describe("提交前暂存策略，默认 staged"),
    pathspecs: pathspecsSchema,
    allowEmpty: z.boolean().optional().describe("是否允许空提交，默认 false"),
  }),
  async execute(args): Promise<ToolResult> {
    const modeValidation = validateCommitMode(args.stage, args.pathspecs);
    if (!modeValidation.success) return modeValidation;

    const commitStage = resolveCommitStage(args.stage, args.pathspecs);
    const prepared = await prepareCommit(commitStage, args.pathspecs);
    if (!prepared.success) return prepared;

    const committed = await runGit(buildCommitArgs(args, commitPathspecs(commitStage, args.pathspecs)));
    return formatCommitResult(committed, prepared.metadata);
  },
});

export const gitTools = [gitStatus, gitDiff, gitLog, gitCommit];
export { gitStatus, gitDiff, gitLog, gitCommit };

function buildDiffArgs(args: {
  mode?: "unstaged" | "staged" | "all";
  stat?: boolean;
  contextLines?: number;
  pathspecs?: string[];
}): string[] {
  const gitArgs = ["diff", ...diffModeArgs(args.mode)];
  if (args.stat) gitArgs.push("--stat");
  if (args.contextLines !== undefined) gitArgs.push(`--unified=${clampInteger(args.contextLines, 0, 1000)}`);
  return withPathspecs(gitArgs, args.pathspecs);
}

function diffModeArgs(mode: "unstaged" | "staged" | "all" | undefined): string[] {
  if (mode === "staged") return ["--cached"];
  if (mode === "all") return ["HEAD"];
  return [];
}

function buildLogArgs(args: {
  limit?: number;
  ref?: string;
  format?: "oneline" | "medium";
  pathspecs?: string[];
}): string[] {
  const gitArgs = ["log", `-n`, String(clampInteger(args.limit ?? 10, 1, 100)), "--decorate"];
  if (args.format !== "medium") gitArgs.push("--oneline");
  if (args.ref) gitArgs.push(args.ref);
  return withPathspecs(gitArgs, args.pathspecs);
}

function buildCommitArgs(
  args: { message: string; body?: string; allowEmpty?: boolean },
  pathspecs: string[] | undefined,
): string[] {
  const gitArgs = ["commit", "-m", args.message];
  if (args.body?.trim()) gitArgs.push("-m", args.body);
  if (args.allowEmpty) gitArgs.push("--allow-empty");
  return withPathspecs(gitArgs, pathspecs);
}

async function prepareCommit(
  commitStage: "staged" | "all" | "paths",
  pathspecs: string[] | undefined,
): Promise<ToolResult> {
  if (commitStage === "all") return formatStageResult(await runGit(["add", "-A"]), commitStage);
  if (commitStage === "paths") return stagePathspecs(pathspecs);
  return { success: true, metadata: { stage: commitStage } };
}

function validateCommitMode(
  stage: "staged" | "all" | "paths" | undefined,
  pathspecs: string[] | undefined,
): ToolResult {
  if (stage === "all" && pathspecs?.length) return { success: false, error: "stage=all 时不能指定 pathspecs" };
  if (stage === "staged" && pathspecs?.length) return { success: false, error: "stage=staged 时不能指定 pathspecs" };
  return { success: true };
}

function resolveCommitStage(
  stage: "staged" | "all" | "paths" | undefined,
  pathspecs: string[] | undefined,
): "staged" | "all" | "paths" {
  return stage ?? (pathspecs?.length ? "paths" : "staged");
}

function commitPathspecs(
  stage: "staged" | "all" | "paths",
  pathspecs: string[] | undefined,
): string[] | undefined {
  return stage === "paths" ? pathspecs : undefined;
}

async function stagePathspecs(pathspecs: string[] | undefined): Promise<ToolResult> {
  const validation = validatePathspecs(pathspecs);
  if (!validation.success) return validation;
  if (!pathspecs || pathspecs.length === 0) {
    return { success: false, error: "stage=paths 时 pathspecs 不能为空" };
  }
  return formatStageResult(await runGit(withPathspecs(["add"], pathspecs)), "paths");
}

function formatStageResult(result: GitRunResult, stage: "all" | "paths"): ToolResult {
  if (result.success) return { success: true, metadata: { stage, stageArgs: result.args } };
  return formatGitResult(result, "git_commit stage");
}

function withPathspecs(gitArgs: string[], pathspecs: string[] | undefined): string[] {
  return pathspecs && pathspecs.length > 0 ? [...gitArgs, "--", ...pathspecs] : gitArgs;
}

function validateLogInput(
  ref: string | undefined,
  pathspecs: string[] | undefined,
): ToolResult {
  if (ref?.startsWith("-")) return { success: false, error: "ref 不能以 - 开头" };
  return validatePathspecs(pathspecs);
}

function validatePathspecs(pathspecs: string[] | undefined): ToolResult {
  for (const pathspec of pathspecs ?? []) {
    if (!isInsideWorkspace(path.resolve(pathspec))) {
      return { success: false, error: `路径穿越拒绝: ${pathspec}` };
    }
  }
  return { success: true };
}

function untrackedArg(value: "normal" | "all" | "none" | undefined): string {
  return `--untracked-files=${value ?? "normal"}`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function runGit(args: string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    attachGitProcessListeners(startGitProcess(args), resolve);
  });
}

function startGitProcess(args: string[]): GitProcess {
  const child = spawn("git", args, {
    cwd: process.cwd(),
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const state = { output: "", timedOut: false };
  const timeout = setTimeout(() => {
    state.timedOut = true;
    killProcessTree(child.pid);
  }, GIT_TIMEOUT_MS);
  return { child, args, state, timeout };
}

function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  killPosixProcessTree(pid);
}

function killPosixProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    tryKillProcess(pid);
  }
  const forceKill = setTimeout(() => forceKillPosixProcessTree(pid), 500);
  forceKill.unref();
}

function forceKillPosixProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    tryKillProcess(pid);
  }
}

function tryKillProcess(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

function attachGitProcessListeners(
  gitProcess: GitProcess,
  resolve: (result: GitRunResult) => void,
): void {
  gitProcess.child.stdout?.on("data", appendOutput(gitProcess.state));
  gitProcess.child.stderr?.on("data", appendOutput(gitProcess.state));
  gitProcess.child.on("error", (error) => finishSpawnError(gitProcess, error, resolve));
  gitProcess.child.on("close", (exitCode, signal) => {
    finishGitProcess({ gitProcess, exitCode, signal, resolve });
  });
}

function appendOutput(state: GitProcess["state"]): (chunk: Buffer) => void {
  return (chunk) => { state.output += chunk.toString("utf-8"); };
}

function finishSpawnError(
  gitProcess: GitProcess,
  error: Error,
  resolve: (result: GitRunResult) => void,
): void {
  clearTimeout(gitProcess.timeout);
  resolve(buildSpawnError(gitProcess.args, error));
}

function finishGitProcess(event: GitCloseEvent): void {
  clearTimeout(event.gitProcess.timeout);
  event.resolve(buildGitResult({
    args: event.gitProcess.args,
    output: event.gitProcess.state.output,
    exitCode: event.exitCode,
    signal: event.signal,
    timedOut: event.gitProcess.state.timedOut,
  }));
}

function buildGitResult(input: CompletedGitProcess): GitRunResult {
  const truncated = truncateOutput(input.output);
  return {
    success: !input.timedOut && input.exitCode === 0,
    output: truncated.text,
    args: input.args,
    exitCode: input.exitCode,
    signal: input.signal,
    timedOut: input.timedOut,
    truncated: truncated.truncated,
  };
}

function buildSpawnError(args: string[], error: Error): GitRunResult {
  return {
    success: false,
    output: "",
    args,
    exitCode: null,
    signal: null,
    timedOut: false,
    truncated: false,
    error: error.message,
  };
}

function truncateOutput(output: string): { text: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_CHARS) return { text: output, truncated: false };
  return {
    text: `${output.slice(0, MAX_OUTPUT_CHARS)}\n... 输出已截断，最多返回 ${MAX_OUTPUT_CHARS} 字符`,
    truncated: true,
  };
}

function formatGitResult(result: GitRunResult, toolName: string): ToolResult {
  return {
    success: result.success,
    data: result.output.trimEnd() || (result.success ? "(无输出)" : ""),
    error: result.success ? undefined : result.error ?? `${toolName} failed with exit code ${result.exitCode ?? "unknown"}`,
    metadata: buildMetadata(result),
  };
}

function formatCommitResult(result: GitRunResult, stageMetadata: Record<string, unknown> | undefined): ToolResult {
  const formatted = formatGitResult(result, "git_commit");
  return {
    ...formatted,
    metadata: {
      ...formatted.metadata,
      ...stageMetadata,
      commit: result.success ? extractCommitHash(result.output) : undefined,
    },
  };
}

function buildMetadata(result: GitRunResult): Record<string, unknown> {
  return {
    args: result.args,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    truncated: result.truncated,
  };
}

function extractCommitHash(output: string): string | undefined {
  return /\[[^\]]*\b([0-9a-f]{7,40})\]/i.exec(output)?.[1];
}
