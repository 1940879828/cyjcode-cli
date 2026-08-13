import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/store.js";
import { handleEffortCommand } from "../src/ui/effortCommand.js";

function createConfig(): AppConfig {
  return {
    baseUrl: "https://example.test",
    apiKey: "test-key",
    model: "deepseek-v4-pro",
    models: ["deepseek-v4-pro"],
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

test("lists current value and available options without args", () => {
  const { store } = createStore();

  const output = handleEffortCommand([], store);

  assert.match(output, /当前 Reasoning Effort: high/);
  assert.match(output, /low \| medium \| high \| xhigh \| max/);
});

test("switches reasoning effort and persists it", () => {
  const { store, getConfig } = createStore();

  const output = handleEffortCommand(["xhigh"], store);

  assert.equal(output, "已设置 Reasoning Effort: xhigh");
  assert.equal(getConfig().reasoningEffort, "xhigh");
});

test("rejects an invalid reasoning effort value", () => {
  const { store, getConfig } = createStore();

  const output = handleEffortCommand(["ultra"], store);

  assert.match(output, /无效的 Reasoning Effort: ultra/);
  assert.equal(getConfig().reasoningEffort, "high");
});

test("warns when setting effort while thinking is disabled", () => {
  const { store } = createStore({ ...createConfig(), thinking: false });

  const output = handleEffortCommand(["max"], store);

  assert.match(output, /已设置 Reasoning Effort: max/);
  assert.match(output, /Thinking 已关闭，该设置暂不生效/);
});
