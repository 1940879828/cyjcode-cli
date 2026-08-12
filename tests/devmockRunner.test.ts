import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionRecording } from "../src/devmock/types.js";

test("devmock runner prefers mock playback over recording", async () => {
  await withWorkspace(async () => {
    const { createDevmockAgentRunner } = await import("../src/devmock/runner.js");
    const recording: SessionRecording = {
      version: 1,
      recordedAt: new Date(0).toISOString(),
      userMessage: "ignored",
      events: [
        { timestamp: 1, event: { type: "user_message", content: "from mock" } },
        { timestamp: 2, event: { type: "done", fullText: "done" } },
      ],
    };
    fs.mkdirSync("mockdata");
    fs.writeFileSync("mockdata/default.json", JSON.stringify(recording), "utf-8");

    const runner = createDevmockAgentRunner({
      recordPath: "recorded.json",
      mockPath: "default.json",
    });
    const events = [];
    for await (const event of runner("live input")) events.push(event);

    assert.deepEqual(events, recording.events.map((entry) => entry.event));
    assert.equal(fs.existsSync("mockdata/recorded.json"), false);
  });
});

async function withWorkspace(run: () => Promise<void>): Promise<void> {
  const previousCwd = process.cwd();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-devmock-"));
  try {
    process.chdir(workspace);
    await run();
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}
