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
  command: z.string().describe("要执行的 shell 命令"),
  description: z.string().optional().describe("一句话说明执行该命令的目的"),
  timeoutMs: optionalNumber().describe("命令超时时间，默认 30000ms，最大 120000ms"),
  shell: shellKindSchema.optional().describe("指定使用的 shell，默认 auto。Windows auto 使用 PowerShell，非 Windows auto 使用 Bash"),
  sideEffects: sideEffectSchema.optional().describe("声明命令副作用。v1 仅记录，不做拦截"),
});

const shell = defineTool({
  name: "shell",
  description:
    "运行本地开发命令，适合测试、类型检查、构建、包管理、git 查询和环境检查。tsx -e 避免顶层 await。文件读写搜索优先使用 read/edit/write/search/listDir；删除、网络、修改 git 历史等命令必须用对应枚举声明 sideEffects。",
  schema: shellArgsSchema,
  async execute(args): Promise<ToolResult> {
    const command = args.command.trim();
    if (!command) {
      return { success: false, error: "command 参数不能为空" };
    }

    const result = await runShellCommand({
      command,
      timeoutMs: args.timeoutMs,
      shell: normalizeShell(args.shell),
    });

    return {
      success: result.success,
      data: result.output || (result.success ? "(无输出)" : ""),
      error: result.error,
      metadata: {
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
      },
    };
  },
});

function normalizeShell(value: z.infer<typeof shellKindSchema> | undefined): ShellKind {
  return value === undefined || value === "" ? "auto" : value;
}

function normalizeSideEffects(value: SideEffect | "" | undefined): SideEffect | undefined {
  return value === "" ? undefined : value;
}

export default shell;
