import assert from "node:assert/strict";
import test from "node:test";
import { createModelConfig, type AppConfig } from "../src/config/store.js";
import { handleThinkingCommand } from "../src/ui/thinkingCommand.js";

function createConfig(): AppConfig {
  return {
    baseUrl: "https://example.test",
    apiKey: "test-key",
    model: "deepseek-v4-pro",
    models: [createModelConfig("deepseek-v4-pro")],
    thinking: true,
    reasoningEffort: "high",
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

test("shows current thinking state without args", () => {
  const { store } = createStore();

  const output = handleThinkingCommand([], store);

  assert.match(output, /当前 Thinking: Enabled/);
});

test("enables thinking", () => {
  const { store, getConfig } = createStore({ ...createConfig(), thinking: false });

  const output = handleThinkingCommand(["on"], store);

  assert.equal(output, "已开启 Thinking");
  assert.equal(getConfig().thinking, true);
});

test("disables thinking", () => {
  const { store, getConfig } = createStore();

  const output = handleThinkingCommand(["off"], store);

  assert.equal(output, "已关闭 Thinking");
  assert.equal(getConfig().thinking, false);
});

test("rejects an invalid toggle value", () => {
  const { store, getConfig } = createStore();

  const output = handleThinkingCommand(["maybe"], store);

  assert.match(output, /用法: \/thinking <on\|off>/);
  assert.equal(getConfig().thinking, true);
});
