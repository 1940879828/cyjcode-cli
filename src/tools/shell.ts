import { z } from "zod";
import { defineTool } from "./defineTool.js";
import { runShellCommand, type ShellKind } from "./shellRunner.js";
import type { ToolResult } from "./types.js";

const sideEffects = [
  "read-in-cwd",
  "read-out-cwd",
  "write-in-cwd",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "unknown",
] as const;

type SideEffect = (typeof sideEffects)[number];

const shellKindSchema = z.union([
  z.literal("auto"),
  z.literal("powershell"),
  z.literal("bash"),
  z.literal(""),
], { error: "shell 只支持 auto、powershell 或 bash" });

const sideEffectSchema = z.union([
  z.enum(sideEffects),
  z.literal(""),
], { error: "sideEffects 参数不在允许的枚举范围内" });

const optionalNumber = () => z.preprocess(
  (value) => (typeof value === "number" ? value : undefined),
  z.number().optional(),
);

const shellArgsSchema = z.object({
  command: z.string().optional().describe("要执行的 shell 命令。多条命令优先使用 commands + stopOnError"),
  commands: z.array(z.string()).optional().describe("按顺序执行的命令列表，避免用 && 拼接 PowerShell 命令"),
  stopOnError: z.boolean().optional().describe("commands 模式下遇到失败是否停止，默认 true"),
  description: z.string().optional().describe("一句话说明执行该命令的目的"),
  timeoutMs: optionalNumber().describe("命令超时时间，默认 30000ms，最大 120000ms"),
  shell: shellKindSchema.optional().describe("指定使用的 shell，默认 auto。Windows auto 使用 PowerShell，非 Windows auto 使用 Bash"),
  sideEffects: sideEffectSchema.optional().describe("声明命令副作用。v1 仅记录，不做拦截"),
});

type ShellArgs = z.infer<typeof shellArgsSchema>;
type ShellResult = Awaited<ReturnType<typeof runShellCommand>>;

const shell = defineTool({
  name: "shell",
  description:
    "运行本地开发命令，适合测试、类型检查、构建、包管理、git 查询和环境检查。多条命令优先用 commands + stopOnError。tsx -e 避免顶层 await。文件读写搜索优先使用 read/edit/write/search/listDir；删除、网络、修改 git 历史等命令必须用对应枚举声明 sideEffects。",
  schema: shellArgsSchema,
  async execute(args): Promise<ToolResult> {
    const commands = resolveCommands(args);
    if (commands.length === 0) {
      return { success: false, error: "command 或 commands 参数不能为空" };
    }

    const shellKind = normalizeShell(args.shell);
    if (usesPowerShell(shellKind) && commands.some(hasPowerShellAndOperator)) {
      return buildPowerShellAndOperatorError();
    }

    const results = await runCommands(commands, args, shellKind);
    return formatShellToolResult(results, args);
  },
});

function resolveCommands(args: ShellArgs): string[] {
  const commandList = args.commands ?? (args.command === undefined ? [] : [args.command]);
  return commandList.map((command) => command.trim()).filter(Boolean);
}

async function runCommands(
  commands: string[],
  args: ShellArgs,
  shellKind: ShellKind,
): Promise<ShellResult[]> {
  const results: ShellResult[] = [];
  for (const command of commands) {
    const result = await runShellCommand({ command, timeoutMs: args.timeoutMs, shell: shellKind });
    results.push(result);
    if (!result.success && shouldStopOnError(args)) break;
  }
  return results;
}

function shouldStopOnError(args: ShellArgs): boolean {
  return args.commands !== undefined && args.stopOnError !== false;
}

function formatShellToolResult(results: ShellResult[], args: ShellArgs): ToolResult {
  const lastResult = results.at(-1);
  if (!lastResult) return { success: false, error: "command 或 commands 参数不能为空" };
  const failedIndex = results.findIndex((result) => !result.success);
  return {
    success: failedIndex === -1,
    data: formatCommandOutputs(results),
    error: failedIndex === -1 ? undefined : formatCommandError(results[failedIndex]!, failedIndex),
    metadata: buildShellMetadata(results, args),
  };
}

function formatCommandOutputs(results: ShellResult[]): string {
  if (results.length === 1) return results[0]?.output || (results[0]?.success ? "(无输出)" : "");
  return results.map(formatCommandOutput).join("\n");
}

function formatCommandOutput(result: ShellResult, index: number): string {
  const status = result.success ? "ok" : "failed";
  const output = result.output.trimEnd() || "(无输出)";
  return `# command ${index + 1} ${status}\n${output}`;
}

function formatCommandError(result: ShellResult, index: number): string {
  return result.error ?? `command ${index + 1} failed with exit code ${result.exitCode ?? "unknown"}`;
}

function buildShellMetadata(results: ShellResult[], args: ShellArgs): Record<string, unknown> {
  const lastResult = results.at(-1)!;
  return {
    ...buildSingleCommandMetadata(lastResult, args),
    commandResults: results.map(buildCommandResultMetadata),
  };
}

function buildSingleCommandMetadata(result: ShellResult, args: ShellArgs): Record<string, unknown> {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    cwd: result.cwd,
    startCwd: result.startCwd,
    shell: result.shell,
    shellPath: result.shellPath,
    truncated: result.truncated,
    cwdReset: result.cwdReset,
    sideEffects: normalizeSideEffects(args.sideEffects),
  };
}

function buildCommandResultMetadata(result: ShellResult, index: number): Record<string, unknown> {
  return {
    index,
    success: result.success,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    cwd: result.cwd,
    truncated: result.truncated,
  };
}

function usesPowerShell(shellKind: ShellKind): boolean {
  return shellKind === "powershell" || (shellKind === "auto" && process.platform === "win32");
}

function hasPowerShellAndOperator(command: string): boolean {
  return command.includes("&&");
}

function buildPowerShellAndOperatorError(): ToolResult {
  return {
    success: false,
    error: "PowerShell 不支持 &&。多条命令请使用 commands + stopOnError。",
  };
}

function normalizeShell(value: z.infer<typeof shellKindSchema> | undefined): ShellKind {
  return value === undefined || value === "" ? "auto" : value;
}

function normalizeSideEffects(value: SideEffect | "" | undefined): SideEffect | undefined {
  return value === "" ? undefined : value;
}

export default shell;
