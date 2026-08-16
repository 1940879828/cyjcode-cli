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
      models: [store.createModelConfig("custom-model")],
      thinking: true,
      reasoningEffort: "high",
      provider: "deepseek",
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

test("normalizes legacy model name lists into model configs", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-config-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    const store = await import(`../src/config/store.ts?legacy=${Date.now()}`);
    fs.mkdirSync(store.getConfigDir(), { recursive: true });
    fs.writeFileSync(store.getConfigPath(), JSON.stringify({
      model: "legacy-model",
      models: ["legacy-model", "deepseek-v4-pro"],
    }));

    assert.deepEqual(store.getConfig().models, [
      store.createModelConfig("legacy-model"),
      store.createModelConfig("deepseek-v4-pro"),
    ]);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("preserves custom context window for the current model", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-config-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    const store = await import(`../src/config/store.ts?window=${Date.now()}`);
    store.setConfig({
      baseUrl: "https://example.test",
      apiKey: "sk-test",
      model: "deepseek-v4-pro",
      models: [store.createModelConfig("deepseek-v4-pro", 2 * 1024 * 1024)],
      thinking: true,
      reasoningEffort: "high",
      provider: "deepseek",
    });

    assert.equal(store.getConfig().models[0]?.contextWindow, 2 * 1024 * 1024);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});
