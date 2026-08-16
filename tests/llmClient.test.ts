import assert from "node:assert/strict";
import test from "node:test";
import { createModelConfig, type AppConfig } from "../src/config/store.js";
import { buildStreamingParamsWithConfig, normalizeCodebuddyBaseUrl } from "../src/llm/client.js";

const createConfig = (thinking: boolean): AppConfig => ({
  baseUrl: "https://example.test",
  apiKey: "test-key",
  model: "deepseek-v4-pro",
  models: [createModelConfig("deepseek-v4-pro")],
  thinking,
  reasoningEffort: "high",
  provider: "deepseek",
});

test("explicitly disables DeepSeek thinking mode", () => {
  const params = buildStreamingParamsWithConfig({
    messages: [{ role: "user", content: "hello" }],
  }, createConfig(false));

  assert.deepEqual(params.thinking, { type: "disabled" });
  assert.equal("reasoning_effort" in params, false);
});

test("enables thinking mode with reasoning effort", () => {
  const params = buildStreamingParamsWithConfig({
    messages: [{ role: "user", content: "hello" }],
  }, createConfig(true));

  assert.deepEqual(params.thinking, { type: "enabled" });
  assert.equal(params.reasoning_effort, "high");
});

test("normalizeCodebuddyBaseUrl appends /v2 prefix when missing", () => {
  assert.equal(normalizeCodebuddyBaseUrl("https://copilot.tencent.com"), "https://copilot.tencent.com/v2");
  assert.equal(normalizeCodebuddyBaseUrl("https://copilot.tencent.com/"), "https://copilot.tencent.com/v2");
});

test("normalizeCodebuddyBaseUrl keeps existing /v2 prefix", () => {
  assert.equal(normalizeCodebuddyBaseUrl("https://copilot.tencent.com/v2"), "https://copilot.tencent.com/v2");
  assert.equal(normalizeCodebuddyBaseUrl("https://copilot.tencent.com/v2/"), "https://copilot.tencent.com/v2");
});
