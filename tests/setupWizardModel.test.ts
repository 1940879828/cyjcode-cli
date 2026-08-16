import assert from "node:assert/strict";
import test from "node:test";
import { createModelConfig, DEFAULT_CONFIG } from "../src/config/store.js";
import {
  appendSetupInput,
  applySetupStep,
  createSetupWizardState,
  maskApiKey,
  removeLastSetupInputCharacter,
} from "../src/ui/setupWizardModel.js";

test("starts with provider step and default values", () => {
  const state = createSetupWizardState();

  assert.equal(state.step, "provider");
  assert.equal(state.values.provider, DEFAULT_CONFIG.provider);
  assert.equal(state.values.baseUrl, DEFAULT_CONFIG.baseUrl);
  assert.equal(state.values.model, DEFAULT_CONFIG.model);
  assert.equal(state.inputValue, "");
});

test("applies editable steps and builds final config", () => {
  const provider = applySetupStep(appendSetupInput(createSetupWizardState(), "2")).state;
  const baseUrl = applySetupStep(appendSetupInput(provider, "https://example.test")).state;
  const apiKey = applySetupStep(appendSetupInput(baseUrl, "sk-test")).state;
  const model = applySetupStep(appendSetupInput(apiKey, "custom-model")).state;
  const result = applySetupStep(model);

  assert.equal(result.state.step, "confirm");
  assert.deepEqual(result.config, {
    baseUrl: "https://example.test",
    apiKey: "sk-test",
    model: "custom-model",
    models: [createModelConfig("custom-model")],
    thinking: DEFAULT_CONFIG.thinking,
    reasoningEffort: DEFAULT_CONFIG.reasoningEffort,
    provider: "deepseek",
  });
});

test("selecting codebuddy applies its default endpoint and model", () => {
  const provider = applySetupStep(appendSetupInput(createSetupWizardState(), "1")).state;
  const baseUrl = applySetupStep(provider).state;
  const apiKey = applySetupStep(appendSetupInput(baseUrl, "ck-test")).state;
  const model = applySetupStep(apiKey).state;
  const result = applySetupStep(model);

  assert.equal(result.state.step, "confirm");
  assert.equal(result.config?.provider, "codebuddy");
  assert.equal(result.config?.baseUrl, "https://copilot.tencent.com/v2");
  assert.equal(result.config?.model, "deepseek-v4-pro");
});

test("uses defaults for optional baseUrl and model", () => {
  const provider = applySetupStep(createSetupWizardState()).state;
  const baseUrl = applySetupStep(provider).state;
  const apiKey = applySetupStep(appendSetupInput(baseUrl, "sk-default")).state;
  const model = applySetupStep(apiKey).state;
  const result = applySetupStep(model);

  assert.equal(result.config?.provider, "deepseek");
  assert.equal(result.config?.baseUrl, DEFAULT_CONFIG.baseUrl);
  assert.equal(result.config?.model, DEFAULT_CONFIG.model);
});

test("removes the last user-visible character", () => {
  const state = appendSetupInput(createSetupWizardState(), "a🙂");
  const next = removeLastSetupInputCharacter(state);

  assert.equal(next.inputValue, "a");
});

test("masks configured api keys", () => {
  assert.equal(maskApiKey(""), "(未设置)");
  assert.equal(maskApiKey("1234567890abcdef"), "12345678...cdef");
});
