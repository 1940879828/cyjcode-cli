import assert from "node:assert/strict";
import test from "node:test";
import { createModelConfig } from "../src/config/store.js";
import type { AppConfig } from "../src/config/store.js";
import { handleModelCommand } from "../src/ui/modelCommand.js";

function createConfig(): AppConfig {
  return {
    baseUrl: "https://example.test",
    apiKey: "test-key",
    model: "deepseek-v4-pro",
    models: [createModelConfig("deepseek-v4-pro")],
    thinking: true,
    reasoningEffort: "max",
    provider: "deepseek",
  };
}

function createStore(config = createConfig()) {
  let current = config;
  return {
    store: {
      getConfig: () => current,
      setConfig: (next: AppConfig) => {
        current = next;
      },
    },
    getConfig: () => current,
  };
}

test("handleModelCommand lists current and available models", () => {
  const { store } = createStore({
    ...createConfig(),
    models: [createModelConfig("deepseek-v4-pro"), createModelConfig("deepseek-v4-flash")],
  });

  const output = handleModelCommand([], store);

  assert.match(output, /当前模型: deepseek-v4-pro/);
  assert.match(output, /\* deepseek-v4-pro \(1M\)/);
  assert.match(output, /deepseek-v4-flash/);
});

test("handleModelCommand switches model and records it", () => {
  const { store, getConfig } = createStore();

  const output = handleModelCommand(["deepseek-v4-flash"], store);

  assert.equal(output, "已切换模型: deepseek-v4-flash");
  assert.equal(getConfig().model, "deepseek-v4-flash");
  assert.deepEqual(getConfig().models, [
    createModelConfig("deepseek-v4-flash"),
    createModelConfig("deepseek-v4-pro"),
  ]);
});

test("handleModelCommand supports explicit add with context window and remove", () => {
  const { store, getConfig } = createStore();

  assert.equal(handleModelCommand(["add", "custom-model", "128K"], store), "已添加模型: custom-model");
  assert.deepEqual(getConfig().models, [
    createModelConfig("custom-model", 128 * 1024),
    createModelConfig("deepseek-v4-pro"),
  ]);
  assert.equal(handleModelCommand(["remove", "custom-model"], store), "已移除模型: custom-model");
  assert.deepEqual(getConfig().models, [createModelConfig("deepseek-v4-pro")]);
});

test("handleModelCommand reports unchanged add and remove operations", () => {
  const { store, getConfig } = createStore();

  assert.equal(handleModelCommand(["add", "deepseek-v4-pro"], store), "模型已存在: deepseek-v4-pro");
  assert.deepEqual(getConfig().models, [createModelConfig("deepseek-v4-pro")]);
  assert.equal(handleModelCommand(["remove", "missing-model"], store), "模型不存在: missing-model");
  assert.deepEqual(getConfig().models, [createModelConfig("deepseek-v4-pro")]);
});

test("handleModelCommand refuses to remove current model", () => {
  const { store, getConfig } = createStore();

  const output = handleModelCommand(["remove", "deepseek-v4-pro"], store);

  assert.equal(output, "不能移除当前模型，请先切换到其他模型");
  assert.deepEqual(getConfig().models, [createModelConfig("deepseek-v4-pro")]);
});

test("handleModelCommand updates existing model context window", () => {
  const { store, getConfig } = createStore();

  const output = handleModelCommand(["add", "deepseek-v4-pro", "2M"], store);

  assert.equal(output, "已更新模型: deepseek-v4-pro");
  assert.equal(getConfig().models[0]?.contextWindow, 2 * 1024 * 1024);
});
