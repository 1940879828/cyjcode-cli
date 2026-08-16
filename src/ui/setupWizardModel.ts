import {
  createModelConfig,
  DEFAULT_CONFIG,
  CODEBUDDY_BASE_URL,
  type AppConfig,
  type Provider,
} from "../config/store.js";

export type SetupStep = "provider" | "baseUrl" | "apiKey" | "model" | "confirm";

export const SETUP_STEP_ORDER: SetupStep[] = ["provider", "baseUrl", "apiKey", "model", "confirm"];
export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  provider: "服务商",
  baseUrl: "URL",
  apiKey: "Key",
  model: "Model",
  confirm: "确认",
};

export interface SetupValues {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SetupWizardState {
  step: SetupStep;
  values: SetupValues;
  inputValue: string;
}

export interface ApplySetupStepResult {
  state: SetupWizardState;
  config: AppConfig | null;
}

export function createSetupWizardState(): SetupWizardState {
  return {
    step: "provider",
    values: {
      provider: DEFAULT_CONFIG.provider,
      baseUrl: DEFAULT_CONFIG.baseUrl,
      apiKey: "",
      model: DEFAULT_CONFIG.model,
    },
    inputValue: "",
  };
}

export function appendSetupInput(
  state: SetupWizardState,
  input: string,
): SetupWizardState {
  return state.step === "confirm"
    ? state
    : { ...state, inputValue: state.inputValue + input };
}

export function removeLastSetupInputCharacter(state: SetupWizardState): SetupWizardState {
  return state.step === "confirm"
    ? state
    : { ...state, inputValue: Array.from(state.inputValue).slice(0, -1).join("") };
}

export function applySetupStep(state: SetupWizardState): ApplySetupStepResult {
  if (state.step === "confirm") {
    return { state, config: createSetupConfig(state.values) };
  }
  return { state: applyEditableStepValue(state), config: null };
}

function applyEditableStepValue(state: SetupWizardState): SetupWizardState {
  if (state.step === "provider") {
    return applyProviderStep(state);
  }
  if (state.step === "baseUrl") {
    return nextSetupStep(state, "apiKey", { baseUrl: state.inputValue || defaultBaseUrl(state.values.provider) });
  }
  if (state.step === "apiKey") {
    return nextSetupStep(state, "model", { apiKey: state.inputValue });
  }
  return nextSetupStep(state, "confirm", { model: state.inputValue || defaultModel(state.values.provider) });
}

function applyProviderStep(state: SetupWizardState): SetupWizardState {
  const provider = parseProviderInput(state.inputValue);
  return nextSetupStep(state, "baseUrl", {
    provider,
    baseUrl: defaultBaseUrl(provider),
    model: defaultModel(provider),
  });
}

function parseProviderInput(input: string): Provider {
  const normalized = input.trim().toLowerCase();
  if (normalized === "1" || normalized === "codebuddy" || normalized === "cb") return "codebuddy";
  if (normalized === "2" || normalized === "deepseek" || normalized === "ds") return "deepseek";
  return DEFAULT_CONFIG.provider;
}

function defaultBaseUrl(provider: Provider): string {
  return provider === "codebuddy" ? CODEBUDDY_BASE_URL : DEFAULT_CONFIG.baseUrl;
}

function defaultModel(provider: Provider): string {
  return provider === "codebuddy" ? "deepseek-v4-pro" : DEFAULT_CONFIG.model;
}

function nextSetupStep(
  state: SetupWizardState,
  step: SetupStep,
  values: Partial<SetupValues>,
): SetupWizardState {
  return {
    step,
    values: { ...state.values, ...values },
    inputValue: "",
  };
}

export function createSetupConfig(values: SetupValues): AppConfig {
  const model = values.model || defaultModel(values.provider);
  const baseUrl = values.baseUrl || defaultBaseUrl(values.provider);
  return {
    baseUrl,
    apiKey: values.apiKey,
    model,
    models: [createModelConfig(model)],
    thinking: DEFAULT_CONFIG.thinking,
    reasoningEffort: DEFAULT_CONFIG.reasoningEffort,
    provider: values.provider,
  };
}

export function maskApiKey(apiKey: string): string {
  return apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : "(未设置)";
}
