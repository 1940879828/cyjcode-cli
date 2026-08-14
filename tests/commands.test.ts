import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getDefaultSkillManager,
  resetDefaultSkillSessionState,
} from "../src/agent/runtime.js";
import { parseSlashInput, slashCommands } from "../src/ui/commands.js";

test("parseSlashInput recognizes /init as an agent command", () => {
  const parsed = parseSlashInput("/init");

  assert.equal(parsed?.command.kind, "init");
  assert.equal(parsed?.command.execution, "agent");
  assert.equal("handler" in (parsed?.command ?? {}), false);
});

test("/help output lists /init", () => {
  const help = parseSlashInput("/help");
  assert.equal(help?.command.execution, "local");
  if (help?.command.execution !== "local") {
    throw new Error("/help should be a local command");
  }

  const output = help.command.handler([], {
    ...createCommandContext(),
  });

  assert.match(output, /\/init\s+生成或更新 AGENTS\.md 项目说明/);
  assert.match(output, /\/model\s+查看、添加和切换模型/);
});

test("slashCommands includes /init", () => {
  assert.ok(slashCommands.some((command) =>
    command.name === "/init" && command.execution === "agent"
  ));
});

test("parseSlashInput recognizes /model as a local command", () => {
  const parsed = parseSlashInput("/model deepseek-v4-flash");

  assert.equal(parsed?.command.kind, "model");
  assert.equal(parsed?.command.execution, "local");
  assert.deepEqual(parsed?.args, ["deepseek-v4-flash"]);
});

test("slashCommands includes /thinking and /effort as local commands", () => {
  assert.ok(slashCommands.some((command) =>
    command.name === "/thinking" && command.execution === "local"
  ));
  assert.ok(slashCommands.some((command) =>
    command.name === "/effort" && command.execution === "local"
  ));
});

test("parseSlashInput recognizes /effort with a value", () => {
  const parsed = parseSlashInput("/effort xhigh");

  assert.equal(parsed?.command.kind, "effort");
  assert.equal(parsed?.command.execution, "local");
  assert.deepEqual(parsed?.args, ["xhigh"]);
});

test("parseSlashInput recognizes /skills as a local command", () => {
  const parsed = parseSlashInput("/skills");

  assert.equal(parsed?.command.kind, "skills");
  assert.equal(parsed?.command.execution, "local");
});

test("parseSlashInput recognizes session commands as local commands", () => {
  assert.equal(parseSlashInput("/new")?.command.kind, "new");
  assert.equal(parseSlashInput("/sessions")?.command.kind, "sessions");
  assert.equal(parseSlashInput("/resume ses_demo")?.command.kind, "resume");
  assert.equal(parseSlashInput("/resume ses_demo")?.command.execution, "local");
});

test("parseSlashInput recognizes installed skill names as agent commands", () => {
  withWorkspaceSkill((workspace) => {
    const parsed = parseSlashInput("/demo-skill hello");

    assert.equal(parsed?.command.kind, "skill");
    assert.equal(parsed?.command.execution, "agent");
    assert.equal(parsed?.command.name, "/demo-skill");
    assert.deepEqual(parsed?.args, ["hello"]);
    assert.equal(parseSlashInput("/missing-skill"), null);
    assert.equal(workspace.includes("tigacode-command-skill-"), true);
  });
});

test("parseSlashInput sees skills created after manager construction", () => {
  withEmptyWorkspace((workspace) => {
    assert.equal(getDefaultSkillManager().list().some((skill) => skill.name === "demo-skill"), false);
    writeDemoSkill(workspace);

    const parsed = parseSlashInput("/demo-skill hello");

    assert.equal(parsed?.command.kind, "skill");
    assert.deepEqual(parsed?.args, ["hello"]);
  });
});

test("/skills output marks loaded skills", () => {
  withWorkspaceSkill(() => {
    resetDefaultSkillSessionState();
    getDefaultSkillManager().state.loadedSkillNames.add("demo-skill");
    const parsed = parseSlashInput("/skills");
    if (parsed?.command.execution !== "local") throw new Error("/skills should be local");

    const output = parsed.command.handler([], {
      ...createCommandContext(),
    });

    assert.match(output, /demo-skill[\s\S]*\[project, loaded\]/);
    resetDefaultSkillSessionState();
  });
});

function withWorkspaceSkill(assertions: (workspace: string) => void): void {
  withEmptyWorkspace((workspace) => {
    writeDemoSkill(workspace);
    assertions(workspace);
  });
}

function createCommandContext() {
  return {
    clearChat: () => {},
    newSession: () => "new",
    listSessions: () => "sessions",
    resumeSession: (sessionId: string) => sessionId,
    startSetup: () => {},
  };
}

function withEmptyWorkspace(assertions: (workspace: string) => void): void {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-command-skill-"));
  try {
    process.chdir(workspace);
    assertions(workspace);
  } finally {
    process.chdir(previousCwd);
  }
}

function writeDemoSkill(workspace: string): void {
  const skillDir = path.join(workspace, ".agents", "skills", "demo-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: demo-skill\ndescription: Demo\n---\n# Demo\n", "utf8");
}
