import {
  createModelConfig,
  DEFAULT_CONFIG,
  type AppConfig,
} from "../config/store.js";

export type SetupStep = "baseUrl" | "apiKey" | "model" | "confirm";

export const SETUP_STEP_ORDER: SetupStep[] = ["baseUrl", "apiKey", "model", "confirm"];
export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  baseUrl: "URL",
  apiKey: "Key",
  model: "Model",
  confirm: "确认",
};

export interface SetupValues {
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
    step: "baseUrl",
    values: {
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
  if (state.step === "baseUrl") {
    return nextSetupStep(state, "apiKey", { baseUrl: state.inputValue || DEFAULT_CONFIG.baseUrl });
  }
  if (state.step === "apiKey") {
    return nextSetupStep(state, "model", { apiKey: state.inputValue });
  }
  return nextSetupStep(state, "confirm", { model: state.inputValue || DEFAULT_CONFIG.model });
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
  const model = values.model || DEFAULT_CONFIG.model;
  const baseUrl = values.baseUrl || DEFAULT_CONFIG.baseUrl;
  return {
    baseUrl,
    apiKey: values.apiKey,
    model,
    models: [createModelConfig(model)],
    thinking: DEFAULT_CONFIG.thinking,
    reasoningEffort: DEFAULT_CONFIG.reasoningEffort,
  };
}

export function maskApiKey(apiKey: string): string {
  return apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : "(未设置)";
}
