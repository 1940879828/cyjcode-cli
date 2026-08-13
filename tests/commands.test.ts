import assert from "node:assert/strict";
import test from "node:test";
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
    clearChat: () => {},
    startSetup: () => {},
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
