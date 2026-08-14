import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ChatMessage } from "../src/llm/types.js";
import {
  expandInitCommandMessages,
  INIT_COMMAND,
  renderInitCommandPrompt,
} from "../src/agent/initCommand.js";
import { PROJECT_INSTRUCTIONS_FILE } from "../src/agent/projectInstructions.js";

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-init-command-"));
}

test("renderInitCommandPrompt asks to create AGENTS.md when none exists", () => {
  const prompt = renderInitCommandPrompt(createWorkspace());

  assert.match(prompt, /请创建 \.\/AGENTS\.md/);
});

test("renderInitCommandPrompt asks to update AGENTS.md when one exists", () => {
  const workspace = createWorkspace();
  fs.writeFileSync(path.join(workspace, PROJECT_INSTRUCTIONS_FILE), "rules", "utf8");

  const prompt = renderInitCommandPrompt(workspace);

  assert.match(prompt, /请更新现有 AGENTS\.md/);
});

test("renderInitCommandPrompt includes required AGENTS.md sections", () => {
  const prompt = renderInitCommandPrompt(createWorkspace());

  for (const section of [
    "开发约定",
    "修改前检查",
    "代码风格守则",
    "代码审查守则",
    "Git 注意事项",
    "提交代码时",
  ]) {
    assert.match(prompt, new RegExp(section));
  }
});

test("renderInitCommandPrompt includes pre-edit checks", () => {
  const prompt = renderInitCommandPrompt(createWorkspace());

  assert.match(prompt, /先阅读本文件并按约定执行/);
  assert.match(prompt, /编辑前检查 `git status`/);
  assert.match(prompt, /完成后至少运行 `npm run typecheck`/);
});

test("renderInitCommandPrompt protects existing AGENTS.md content", () => {
  const workspace = createWorkspace();
  fs.writeFileSync(path.join(workspace, PROJECT_INSTRUCTIONS_FILE), "custom rules", "utf8");

  const prompt = renderInitCommandPrompt(workspace);

  assert.match(prompt, /先完整读取现有内容/);
  assert.match(prompt, /保留用户已经写好的项目约定/);
  assert.match(prompt, /不得整体覆盖/);
});

test("renderInitCommandPrompt includes engineering judgment guidance", () => {
  const prompt = renderInitCommandPrompt(createWorkspace());

  assert.match(prompt, /第一性原理/);
  assert.match(prompt, /禁止症状遮蔽式工程/);
  assert.match(prompt, /temporary mitigation/);
});

test("expandInitCommandMessages replaces only user /init messages", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: INIT_COMMAND },
    { role: "user", content: "hello" },
    { role: "assistant", content: INIT_COMMAND },
    { role: "user", content: `  ${INIT_COMMAND}  ` },
  ];

  const expanded = expandInitCommandMessages(messages);

  assert.equal(expanded[0]?.content, INIT_COMMAND);
  assert.equal(expanded[1]?.content, "hello");
  assert.equal(expanded[2]?.content, INIT_COMMAND);
  assert.notEqual(expanded[3]?.content, messages[3]?.content);
  assert.match(expanded[3]?.content ?? "", /请生成或更新中文 AGENTS\.md/);
});
