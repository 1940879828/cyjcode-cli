import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/store.js";
import { buildStreamingParamsWithConfig, toTokenUsage } from "../src/llm/client.js";

const createConfig = (thinking: boolean): AppConfig => ({
  baseUrl: "https://example.test",
  apiKey: "test-key",
  model: "deepseek-v4-pro",
  models: ["deepseek-v4-pro"],
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

test("maps DeepSeek cache usage fields", () => {
  assert.deepEqual(toTokenUsage({
    prompt_tokens: 1000,
    completion_tokens: 100,
    total_tokens: 1100,
    prompt_cache_hit_tokens: 900,
    prompt_cache_miss_tokens: 100,
  }), {
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cacheHitTokens: 900,
    cacheMissTokens: 100,
  });
});

test("maps OpenAI-compatible cached token usage field", () => {
  assert.deepEqual(toTokenUsage({
    prompt_tokens: 1000,
    completion_tokens: 100,
    total_tokens: 1100,
    prompt_tokens_details: { cached_tokens: 800 },
  }), {
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cacheHitTokens: 800,
    cacheMissTokens: 200,
  });
});
