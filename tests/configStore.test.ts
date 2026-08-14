import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("writes config with private file permissions on posix", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-config-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    const store = await import(`../src/config/store.ts?home=${Date.now()}`);
    store.setConfig({
      baseUrl: "https://example.test",
      apiKey: "sk-test",
      model: "custom-model",
      models: ["custom-model"],
      thinking: true,
      reasoningEffort: "high",
    });

    assert.equal(fs.existsSync(store.getConfigPath()), true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(store.getConfigPath()).mode & 0o777, 0o600);
    }
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
