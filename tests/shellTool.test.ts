import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import shell from "../src/tools/shell.js";

test("shell auto runs a simple command and returns stdout", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: `${nodeCommand()} -e "console.log('hello shell')"`,
      shell: "auto",
    });

    assert.equal(result.success, true);
    assert.match(result.data ?? "", /hello shell/);
    assert.equal(typeof result.metadata?.shellPath, "string");
  });
});

test("shell reports non-zero exit codes as failure", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: `${nodeCommand()} -e "process.exit(7)"`,
    });

    assert.equal(result.success, false);
    assert.equal(result.metadata?.exitCode, 7);
  });
});

test("bash captures exit code when command exits explicitly", async (context) => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: "exit 7",
      shell: "bash",
    });

    if (result.error?.includes("找不到可用的 bash shell")) {
      context.skip("bash is unavailable on this machine");
      return;
    }

    assert.equal(result.success, false);
    assert.equal(result.metadata?.exitCode, 7);
  });
});

test("shell times out and marks timedOut", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: `${nodeCommand()} -e "setTimeout(() => {}, 2000)"`,
      timeoutMs: 100,
    });

    assert.equal(result.success, false);
    assert.equal(result.metadata?.timedOut, true);
  });
});

test("shell truncates output above 30000 characters", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: `${nodeCommand()} -e "process.stdout.write('x'.repeat(31000))"`,
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata?.truncated, true);
    assert.ok((result.data ?? "").length > 30000);
    assert.ok((result.data ?? "").length < 30200);
  });
});

test("shell keeps cwd across calls", async () => {
  await withWorkspace(async (workspace) => {
    fs.mkdirSync(path.join(workspace, "nested"));

    const cdResult = await shell.execute({ command: cdCommand("nested") });
    const pwdResult = await shell.execute({ command: cwdCommand() });

    assert.equal(cdResult.success, true);
    assert.equal(pwdResult.success, true);
    assert.equal(path.normalize(String(pwdResult.data).trim()), path.join(workspace, "nested"));
  });
});

test("shell resets cwd when command leaves workspace", async () => {
  await withWorkspace(async (workspace) => {
    const result = await shell.execute({ command: cdCommand(path.dirname(workspace)) });

    assert.equal(result.success, true);
    assert.equal(result.metadata?.cwdReset, true);
    assert.equal(result.metadata?.cwd, workspace);
  });
});

test("shell resets cwd when command enters a sibling directory with the same prefix", async () => {
  await withWorkspace(async (workspace) => {
    const sibling = `${workspace}-sibling`;
    fs.mkdirSync(sibling);

    try {
      const result = await shell.execute({ command: cdCommand(sibling) });

      assert.equal(result.success, true);
      assert.equal(result.metadata?.cwdReset, true);
      assert.equal(result.metadata?.cwd, workspace);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });
});

test("shell rejects empty command", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({ command: "   " });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /command 参数不能为空/);
  });
});

test("shell rejects unsupported shell values", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: "echo nope",
      shell: "fish",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /shell 只支持/);
  });
});

test("shell rejects unsupported sideEffects values", async () => {
  await withWorkspace(async () => {
    const result = await shell.execute({
      command: "echo nope",
      sideEffects: "write-everywhere",
    });

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /sideEffects 参数不在允许的枚举范围内/);
  });
});

async function withWorkspace(run: (workspace: string) => Promise<void>): Promise<void> {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-shell-"));
  try {
    process.chdir(workspace);
    await run(workspace);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function nodeCommand(): string {
  if (process.platform === "win32") {
    return `& ${quotePowerShell(process.execPath)}`;
  }
  return quoteBash(process.execPath);
}

function cdCommand(targetPath: string): string {
  return process.platform === "win32" ? `Set-Location ${quotePowerShell(targetPath)}` : `cd ${quoteBash(targetPath)}`;
}

function cwdCommand(): string {
  return process.platform === "win32" ? "(Get-Location).Path" : "pwd";
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteBash(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
