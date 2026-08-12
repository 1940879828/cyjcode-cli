import { runShellCommand, type ShellKind } from "./shellRunner.js";
import type { Tool, ToolResult } from "./types.js";

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
const sideEffectSet = new Set<string>(sideEffects);

const shell: Tool = {
  name: "shell",
  description:
    "运行本地开发命令，适合测试、类型检查、构建、包管理、git 查询和环境检查。文件读写搜索优先使用 read/edit/write/search/listDir；删除、网络、修改 git 历史等命令必须用对应枚举声明 sideEffects。",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要执行的 shell 命令",
      },
      description: {
        type: "string",
        description: "一句话说明执行该命令的目的",
      },
      timeoutMs: {
        type: "number",
        description: "命令超时时间，默认 30000ms，最大 120000ms",
      },
      shell: {
        type: "string",
        enum: ["auto", "powershell", "bash"],
        description: "指定使用的 shell，默认 auto。Windows auto 使用 PowerShell，非 Windows auto 使用 Bash",
        default: "auto",
      },
      sideEffects: {
        type: "string",
        enum: sideEffects,
        description: "声明命令副作用。v1 仅记录，不做拦截",
      },
    },
    required: ["command"],
  },

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    const requestedShell = parseShell(args.shell);
    const requestedSideEffects = parseSideEffects(args.sideEffects);

    if (!command) {
      return { success: false, error: "command 参数不能为空" };
    }
    if (!requestedShell.success) {
      return { success: false, error: requestedShell.error };
    }
    if (!requestedSideEffects.success) {
      return { success: false, error: requestedSideEffects.error };
    }

    const result = await runShellCommand({
      command,
      timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
      shell: requestedShell.value,
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
        sideEffects: requestedSideEffects.value,
      },
    };
  },
};

function parseShell(value: unknown): { success: true; value: ShellKind } | { success: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { success: true, value: "auto" };
  }
  if (value === "auto" || value === "powershell" || value === "bash") {
    return { success: true, value };
  }
  return { success: false, error: "shell 只支持 auto、powershell 或 bash" };
}

function parseSideEffects(value: unknown): { success: true; value?: string } | { success: false; error: string } {
  if (value === undefined || value === null || value === "") {
    return { success: true };
  }
  if (isSideEffect(value)) {
    return { success: true, value };
  }
  return { success: false, error: "sideEffects 参数不在允许的枚举范围内" };
}

function isSideEffect(value: unknown): value is SideEffect {
  return typeof value === "string" && sideEffectSet.has(value);
}

export default shell;
