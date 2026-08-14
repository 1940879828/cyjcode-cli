import assert from "node:assert/strict";
import test from "node:test";
import { createModelConfig, type AppConfig } from "../src/config/store.js";
import { buildStreamingParamsWithConfig } from "../src/llm/client.js";

const createConfig = (thinking: boolean): AppConfig => ({
  baseUrl: "https://example.test",
  apiKey: "test-key",
  model: "deepseek-v4-pro",
  models: [createModelConfig("deepseek-v4-pro")],
  thinking,
  reasoningEffort: "high",
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
