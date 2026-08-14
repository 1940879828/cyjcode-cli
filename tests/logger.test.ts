import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";
import type { LogEntry } from "../src/utils/logger.js";

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-logger-"));
process.env.HOME = homeDir;
process.env.USERPROFILE = homeDir;

const logger = await import("../src/utils/logger.js");

beforeEach(async () => {
  await logger.flushLogs();
  fs.rmSync(path.dirname(logger.getTodayLogPath()), { recursive: true, force: true });
});

test("log queues JSONL writes in call order", async () => {
  logger.log("tool.start", { tool: "first" });
  logger.log("tool.end", { tool: "second", success: true });

  await logger.flushLogs();

  const entries = readTodayEntries();
  assert.deepEqual(entries.map((entry) => entry.type), ["tool.start", "tool.end"]);
  assert.deepEqual(entries.map((entry) => entry.data.tool), ["first", "second"]);
});

test("log creates the logs directory asynchronously", async () => {
  const logsDir = path.dirname(logger.getTodayLogPath());
  fs.rmSync(logsDir, { recursive: true, force: true });

  logger.log("session.start", { sessionId: "new-dir" });
  await logger.flushLogs();

  assert.equal(fs.existsSync(logsDir), true);
  assert.equal(readTodayEntries()[0]?.data.sessionId, "new-dir");
});

test("log keeps a synchronous void interface", async () => {
  const result = logger.log("llm.request", { model: "test", messageCount: 1 });

  assert.equal(result, undefined);
  await logger.flushLogs();
});

function readTodayEntries(): LogEntry[] {
  const fileName = path.basename(logger.getTodayLogPath());
  return logger.readLogLines(fileName).map(parseLogEntry);
}

function parseLogEntry(line: string): LogEntry {
  return JSON.parse(line) as LogEntry;
}
