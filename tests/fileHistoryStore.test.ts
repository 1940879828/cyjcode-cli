import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileHistoryStore } from "../src/agent/fileHistoryStore.js";

test("file history starts empty when messages file is missing", () => {
  withHistoryFile((filePath) => {
    const history = new FileHistoryStore(filePath);

    assert.deepEqual(history.getMessages(), []);
    assert.equal(fs.existsSync(filePath), true);
  });
});

test("file history persists added messages", () => {
  withHistoryFile((filePath) => {
    const history = new FileHistoryStore(filePath);
    history.addMessage({ role: "user", content: "hello" });

    assert.deepEqual(new FileHistoryStore(filePath).getMessages(), [
      { role: "user", content: "hello" },
    ]);
  });
});

test("file history appends message records instead of rewriting an array", () => {
  withHistoryFile((filePath) => {
    const history = new FileHistoryStore(filePath);
    history.addMessage({ role: "user", content: "one" });
    history.addMessage({ role: "assistant", content: "two" });

    const records = readRecords(filePath);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((record) => record.type), ["message", "message"]);
  });
});

test("file history truncates by appending a truncate record", () => {
  withHistoryFile((filePath) => {
    const history = new FileHistoryStore(filePath);
    history.addMessage({ role: "user", content: "one" });
    history.addMessage({ role: "assistant", content: "two" });
    history.truncate(1);

    assert.deepEqual(readRecords(filePath).map((record) => record.type), [
      "message",
      "message",
      "truncate",
    ]);
    assert.deepEqual(history.getMessages(), [{ role: "user", content: "one" }]);
    assert.deepEqual(new FileHistoryStore(filePath).getMessages(), history.getMessages());
  });
});

test("file history skips a no-op truncate instead of appending a record", () => {
  withHistoryFile((filePath) => {
    const history = new FileHistoryStore(filePath);
    history.addMessage({ role: "user", content: "one" });
    history.addMessage({ role: "assistant", content: "two" });
    history.truncate(100);

    assert.deepEqual(readRecords(filePath).map((record) => record.type), [
      "message",
      "message",
    ]);
    assert.deepEqual(history.getMessages(), [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);
  });
});

test("file history tolerates invalid JSON", () => {
  withHistoryFile((filePath) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{", "utf-8");

    assert.deepEqual(new FileHistoryStore(filePath).getMessages(), []);
  });
});

test("file history can read legacy JSON array files", () => {
  withHistoryFile((filePath) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath.slice(0, -1), JSON.stringify([
      { role: "user", content: "legacy" },
    ]), "utf-8");

    assert.deepEqual(new FileHistoryStore(filePath).getMessages(), [
      { role: "user", content: "legacy" },
    ]);
  });
});

test("file history migrates legacy JSON before appending", () => {
  withHistoryFile((filePath) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath.slice(0, -1), JSON.stringify([
      { role: "user", content: "legacy" },
    ]), "utf-8");

    new FileHistoryStore(filePath).addMessage({ role: "assistant", content: "new" });

    assert.deepEqual(new FileHistoryStore(filePath).getMessages(), [
      { role: "user", content: "legacy" },
      { role: "assistant", content: "new" },
    ]);
  });
});

function withHistoryFile(assertions: (filePath: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-history-"));
  try {
    assertions(path.join(dir, "messages.jsonl"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readRecords(filePath: string): Array<{ type: string }> {
  return fs.readFileSync(filePath, "utf-8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string });
}
