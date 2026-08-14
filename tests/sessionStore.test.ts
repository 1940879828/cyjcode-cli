import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "../src/agent/sessionStore.js";

test("session store creates session files and current pointer", () => {
  withStore((store, workspaceRoot, baseDir) => {
    const session = store.createSession(workspaceRoot);
    const workspaceDir = path.join(baseDir, store.workspaceKey(workspaceRoot));

    assert.equal(fs.existsSync(path.join(workspaceDir, session.id, "session.json")), true);
    assert.equal(fs.existsSync(path.join(workspaceDir, session.id, "messages.jsonl")), true);
    assert.equal(store.getCurrentSession(workspaceRoot)?.id, session.id);
  });
});

test("session store lists sessions by updated time", async () => {
  await withStoreAsync(async (store, workspaceRoot) => {
    const older = store.createSession(workspaceRoot);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = store.createSession(workspaceRoot);

    assert.deepEqual(store.listSessions(workspaceRoot).map((item) => item.id), [
      newer.id,
      older.id,
    ]);
  });
});

test("session store current session can be changed", () => {
  withStore((store, workspaceRoot) => {
    const first = store.createSession(workspaceRoot);
    store.createSession(workspaceRoot);

    assert.equal(store.setCurrentSession(workspaceRoot, first.id), true);
    assert.equal(store.getCurrentSession(workspaceRoot)?.id, first.id);
  });
});

test("session store isolates different workspaces", () => {
  withStore((store, workspaceRoot) => {
    const otherWorkspace = path.join(workspaceRoot, "other");
    const first = store.createSession(workspaceRoot);
    const second = store.createSession(otherWorkspace);

    assert.notEqual(store.workspaceKey(workspaceRoot), store.workspaceKey(otherWorkspace));
    assert.deepEqual(store.listSessions(workspaceRoot).map((item) => item.id), [first.id]);
    assert.deepEqual(store.listSessions(otherWorkspace).map((item) => item.id), [second.id]);
  });
});

test("session store normalizes Windows workspace casing consistently", () => {
  if (process.platform !== "win32") return;
  withStore((store, workspaceRoot) => {
    const session = store.createSession(workspaceRoot.toUpperCase());

    assert.equal(store.workspaceKey(workspaceRoot), store.workspaceKey(workspaceRoot.toUpperCase()));
    assert.equal(session.workspaceRoot, workspaceRoot.replaceAll("\\", "/").toLowerCase());
  });
});

function withStore(assertions: (store: SessionStore, workspaceRoot: string, baseDir: string) => void): void {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-sessions-"));
  try {
    assertions(new SessionStore(baseDir), path.join(baseDir, "workspace"), baseDir);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}

async function withStoreAsync(
  assertions: (store: SessionStore, workspaceRoot: string, baseDir: string) => Promise<void>,
): Promise<void> {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-sessions-"));
  try {
    await assertions(new SessionStore(baseDir), path.join(baseDir, "workspace"), baseDir);
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
}
