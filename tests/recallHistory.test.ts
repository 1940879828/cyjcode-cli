import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMemoryHistoryStore } from "../src/agent/runtime.js";
import { createObservationStore } from "../src/agent/observationStore.js";
import { contentFingerprint } from "../src/utils/contentFingerprint.js";
import { getTool } from "../src/tools/index.js";
import type { ToolResult } from "../src/tools/types.js";

test("recall_history returns fresh for unchanged file observations", async () => {
  const workspace = createWorkspace();
  try {
    const filePath = writeFile(workspace, "same.ts", "const value = 1;\n");
    const store = createStoreWithFileMask(filePath, "const value = 1;\n");
    const result = await recall("mask_file", workspace, store);

    assert.equal(result.success, true);
    assert.equal(JSON.parse(result.data ?? "{}").freshness, "fresh");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("recall_history returns stale when a file changes", async () => {
  const workspace = createWorkspace();
  try {
    const filePath = writeFile(workspace, "changed.ts", "before\n");
    const store = createStoreWithFileMask(filePath, "before\n");
    fs.writeFileSync(filePath, "after\n", "utf-8");
    const result = await recall("mask_file", workspace, store);

    assert.equal(result.success, true);
    assert.equal(JSON.parse(result.data ?? "{}").freshness, "stale");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("recall_history returns unknown for non-file observations", async () => {
  const workspace = createWorkspace();
  try {
    const store = createObservationStore();
    store.put(unknownMask());
    const result = await recall("mask_shell", workspace, store);

    assert.equal(result.success, true);
    assert.equal(JSON.parse(result.data ?? "{}").freshness, "unknown");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("recall_history reports unknown mask ids", async () => {
  const workspace = createWorkspace();
  try {
    const result = await recall("mask_missing", workspace, createObservationStore());

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /未知的历史遮罩/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-recall-history-"));
}

function writeFile(workspace: string, name: string, content: string): string {
  const filePath = path.join(workspace, name);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function createStoreWithFileMask(filePath: string, content: string) {
  const store = createObservationStore();
  store.put({
    id: "mask_file",
    toolName: "read",
    summary: "read file",
    originalText: content,
    source: { kind: "file", filePath, contentFingerprint: contentFingerprint(content) },
    createdAt: 1,
  });
  return store;
}

function unknownMask() {
  return {
    id: "mask_shell",
    toolName: "shell",
    summary: "npm test passed",
    originalText: "shell\nnpm test passed",
    source: { kind: "unknown" as const },
    createdAt: 1,
  };
}

async function recall(
  maskId: string,
  workspace: string,
  store: ReturnType<typeof createObservationStore>,
): Promise<ToolResult> {
  const tool = getTool("recall_history");
  assert.ok(tool);
  return await tool.execute({ maskId }, {
    sessionId: "test-session",
    history: createMemoryHistoryStore(),
    workspaceRoot: workspace,
    observationStore: store,
  });
}
