import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgentLoop } from "../src/agent/loop.js";
import { executeToolCalls } from "../src/agent/toolExecution.js";
import type { AgentEvent } from "../src/agent/types.js";
import {
  type AgentRuntime,
  createDefaultAgentRuntime,
  resetDefaultSkillSessionState,
  type AgentHistoryStore,
} from "../src/agent/runtime.js";
import { createObservationStore } from "../src/agent/observationStore.js";
import type { ChatMessage, ToolCall } from "../src/llm/types.js";
import {
  createSkillManager,
} from "../src/skills/index.js";
import { toolsToOpenAI } from "../src/tools/index.js";

test("high-confidence prompts auto-inject full skill content", () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const manager = createSkillManager(workspace);

  const injections = manager.routeUserMessage("需要改表做 schema change migration");

  assert.equal(injections.length, 1);
  assert.match(injections[0]?.content ?? "", /<loaded_skill name="db-migration"/);
  assert.match(injections[0]?.content ?? "", /name: db-migration/);
  assert.match(injections[0]?.content ?? "", /<metadata>/);
  assert.match(injections[0]?.content ?? "", /# DB Migration/);
});

test("medium-confidence prompts add a skill listing without loading content", () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const manager = createSkillManager(workspace);

  const messages = manager.routeUserMessage("rollback");

  assert.equal(messages.length, 1);
  assert.match(messages[0]?.content ?? "", /<skill_listing>/);
  assert.match(messages[0]?.content ?? "", /db-migration/);
  assert.doesNotMatch(messages[0]?.content ?? "", /<loaded_skill/);
  assert.equal(manager.state.loadedSkillNames.has("db-migration"), false);
});

test("medium-confidence skill listings are not repeated within one session", () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const manager = createSkillManager(workspace);

  manager.routeUserMessage("rollback");
  const second = manager.routeUserMessage("rollback");

  assert.deepEqual(second, []);
});

test("skill injection is not repeated within one session", () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const manager = createSkillManager(workspace);

  manager.routeUserMessage("需要改表做 schema change migration");
  const second = manager.routeUserMessage("继续处理 migration rollback");

  assert.deepEqual(second, []);
});

test("resource paths are listed without injecting resource body", () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);

  const result = createSkillManager(workspace).load("db-migration", "users.status", "manual");

  assert.match(result.injection?.content ?? "", /<file>references\/schema.md<\/file>/);
  assert.doesNotMatch(result.injection?.content ?? "", /SECRET RESOURCE BODY/);
  assert.match(result.injection?.content ?? "", /<arguments>users.status<\/arguments>/);
});

test("default agent runtimes share skill session state across user turns", () => {
  resetDefaultSkillSessionState();
  createDefaultAgentRuntime().skillManager.state.loadedSkillNames.add("db-migration");

  assert.equal(createDefaultAgentRuntime().skillManager.state.loadedSkillNames.has("db-migration"), true);
  resetDefaultSkillSessionState();
});

test("skill tool result does not include full loaded skill content", async () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const history = createMemoryHistory();

  const events = await drainToolCalls({
    workspace,
    history,
    toolCalls: [skillToolCall("call_skill", "db-migration")],
  });

  const toolResult = events.find((event) => event.type === "tool_result");
  assert.equal(toolResult?.type, "tool_result");
  assert.doesNotMatch(JSON.stringify(toolResult.result), /followUpMessages|contextModifier|<loaded_skill|# DB Migration/);

  const messages = history.getMessages();
  assert.equal(messages[0]?.role, "tool");
  assert.doesNotMatch(messages[0]?.content ?? "", /<loaded_skill/);
  assert.doesNotMatch(messages[0]?.content ?? "", /# DB Migration/);
  assert.match(messages[0]?.content ?? "", /Launching skill: db-migration/);
  assert.match(messages[1]?.content ?? "", /<loaded_skill name="db-migration"/);
});

test("skill follow-up messages are appended after all tool results", async () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const filePath = path.join(workspace, "schema.txt");
  fs.writeFileSync(filePath, "schema", "utf8");
  const history = createMemoryHistory();

  await drainToolCalls({
    workspace,
    history,
    toolCalls: [
      skillToolCall("call_skill", "db-migration"),
      readToolCall("call_read", filePath),
    ],
  });

  const messages = history.getMessages();
  assert.deepEqual(messages.map((message) => message.role), ["tool", "tool", "system"]);
  assert.equal(messages[0]?.name, "skill");
  assert.equal(messages[1]?.name, "read");
  assert.match(messages[2]?.content ?? "", /<loaded_skill name="db-migration"/);
});

test("skill tool repeat call reports skip without follow-up injection", async () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const history = createMemoryHistory();

  await drainToolCalls({
    workspace,
    history,
    toolCalls: [
      skillToolCall("call_first", "db-migration"),
      skillToolCall("call_second", "db-migration"),
    ],
  });

  const messages = history.getMessages();
  assert.equal(messages.filter((message) => message.role === "system").length, 1);
  assert.match(messages[1]?.content ?? "", /skill 已加载，跳过重复注入/);
  assert.doesNotMatch(messages[1]?.content ?? "", /<loaded_skill/);
});

test("skill tool remains exposed after protocol upgrade", () => {
  assert.equal(toolsToOpenAI().some((tool) => String(JSON.stringify(tool)).includes('"name":"skill"')), true);
});

test("skill manager sees skills created after construction", () => {
  const workspace = createWorkspace();
  const manager = createSkillManager(workspace);

  assert.equal(manager.list().some((skill) => skill.name === "db-migration"), false);
  writeDbMigrationSkill(workspace);

  assert.equal(manager.list().some((skill) => skill.name === "db-migration"), true);
  assert.equal(manager.load("db-migration").success, true);
});

test("skill session snapshot restores loaded and suggested state", () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const manager = createSkillManager(workspace);
  const snapshot = manager.snapshot();

  manager.routeUserMessage("rollback");
  manager.load("db-migration");
  manager.restore(snapshot);

  assert.equal(manager.state.loadedSkillNames.has("db-migration"), false);
  assert.equal(manager.state.suggestedSkillNames.has("db-migration"), false);
  assert.deepEqual(manager.state.lastCandidates, []);
});

test("aborted agent turn restores history and skill state", async () => {
  const workspace = createWorkspace();
  writeDbMigrationSkill(workspace);
  const runtime = createTestRuntime(workspace);
  const controller = new AbortController();
  controller.abort();

  for await (const _event of runAgentLoop("需要改表做 schema change migration", {
    runtime,
    signal: controller.signal,
  })) {
    // Drain generator.
  }

  assert.equal(runtime.history.getLength(), 0);
  assert.equal(runtime.skillManager.state.loadedSkillNames.has("db-migration"), false);
});

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-skills-injection-"));
}

function createMemoryHistory(messages: ChatMessage[] = []): AgentHistoryStore {
  return {
    addMessage: (message) => messages.push(message),
    getMessages: () => [...messages],
    getLength: () => messages.length,
    truncate: (length) => {
      messages.length = Math.max(0, Math.min(length, messages.length));
    },
  };
}

function createTestRuntime(workspace: string): AgentRuntime {
  const history = createMemoryHistory();
  const skillManager = createSkillManager(workspace);
  return {
    history,
    sessionId: "test-session",
    workspaceRoot: workspace,
    log: () => {},
    buildSystemPrompt: () => "system",
    skillManager,
    observationStore: createObservationStore(),
  };
}

async function drainToolCalls(input: {
  workspace: string;
  history: AgentHistoryStore;
  toolCalls: ToolCall[];
}): Promise<AgentEvent[]> {
  const manager = createSkillManager(input.workspace);
  const collectedEvents: AgentEvent[] = [];
  const events = executeToolCalls({
    sessionId: "test-session",
    turn: 1,
    toolCalls: input.toolCalls,
    history: input.history,
    workspaceRoot: input.workspace,
    skillManager: manager,
  });
  for await (const _event of events) {
    collectedEvents.push(_event);
  }
  return collectedEvents;
}

function skillToolCall(id: string, name: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name: "skill", arguments: JSON.stringify({ name }) },
  };
}

function readToolCall(id: string, filePath: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name: "read", arguments: JSON.stringify({ filePath }) },
  };
}

function writeDbMigrationSkill(workspace: string): void {
  const skillDir = path.join(workspace, ".agents", "skills", "db-migration");
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "references", "schema.md"), "SECRET RESOURCE BODY", "utf8");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), dbMigrationContent(), "utf8");
}

function dbMigrationContent(): string {
  return `---
name: db-migration
description: Create database migrations
aliases: [改表, schema change, migration]
keywords: [rollback, 表结构]
---

# DB Migration

Use this workflow for schema changes.
`;
}
