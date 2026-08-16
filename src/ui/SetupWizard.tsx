import React, { useState, useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { Box, Text, useCursor, useInput, usePaste, measureElement } from "ink";
import type { CursorPosition, DOMElement } from "ink";
import stringWidth from "string-width";
import { setConfig, DEFAULT_CONFIG } from "../config/store.js";
import { APP } from "../config/app.js";
import {
  SETUP_STEP_LABELS,
  SETUP_STEP_ORDER,
  appendSetupInput,
  applySetupStep,
  createSetupWizardState,
  maskApiKey,
  removeLastSetupInputCharacter,
} from "./setupWizardModel.js";
import type { SetupWizardState } from "./setupWizardModel.js";

interface Props {
  onComplete: () => void;
  isExiting?: boolean;
  exitStatusMessage?: string | null;
}

interface SetupWizardInput {
  stateRef: MutableRefObject<SetupWizardState>;
  commitState: (state: SetupWizardState) => void;
  applyStepValue: () => void;
  isActive: boolean;
}

const SetupWizard = ({ onComplete, isExiting = false, exitStatusMessage }: Props) => {
  const [state, setState] = useState(createSetupWizardState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const stepIdx = SETUP_STEP_ORDER.indexOf(state.step);
  const commitState = (nextState: SetupWizardState) => {
    stateRef.current = nextState;
    setState(nextState);
  };
  const applyStepValue = () => applyCurrentStep(stateRef.current, commitState, onComplete);
  useSetupWizardInput({ stateRef, commitState, applyStepValue, isActive: !isExiting });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}><Text color="cyan" bold>⚡ {APP.name} — 首次配置引导</Text></Box>

      <Box marginBottom={1}>
        {SETUP_STEP_ORDER.map((s, i) => (
          <Text key={s}>
            <Text color={i <= stepIdx ? "green" : "gray"}>
              {i <= stepIdx ? "●" : "○"} {SETUP_STEP_LABELS[s]}
            </Text>
            {i < SETUP_STEP_ORDER.length - 1 && <Text color="gray">{" — "}</Text>}
          </Text>
        ))}
      </Box>

      <Box marginY={1}>
        <Text color="gray" dimColor>{"—".repeat(40)}</Text>
      </Box>

      <StepContent
        state={state}
        isExiting={isExiting}
      />

      <Box marginY={1}>
        <Text color={exitStatusMessage ? "yellow" : "gray"}>{exitStatusMessage ?? "按 Enter 继续"}</Text>
      </Box>
    </Box>
  );
};

function useSetupWizardInput(input: SetupWizardInput): void {
  useInput((text, key) => {
    if (input.stateRef.current.step === "confirm") {
      if (key.return || text === "y" || text === "Y") input.applyStepValue();
      return;
    }

    if (key.return) return input.applyStepValue();
    if (key.backspace || key.delete) {
      return input.commitState(removeLastSetupInputCharacter(input.stateRef.current));
    }
    if (key.ctrl || key.meta || text.length === 0) return;

    input.commitState(appendSetupInput(input.stateRef.current, text));
  }, { isActive: input.isActive });

  usePaste((text) => {
    input.commitState(appendSetupInput(input.stateRef.current, text));
  }, { isActive: input.isActive });
}

function applyCurrentStep(
  state: SetupWizardState,
  commitState: (state: SetupWizardState) => void,
  onComplete: () => void,
): void {
  const result = applySetupStep(state);
  if (result.config) {
    setConfig(result.config);
    onComplete();
    return;
  }
  commitState(result.state);
}

const StepContent = ({
  state,
  isExiting,
}: {
  state: SetupWizardState;
  isExiting: boolean;
}) => {
  switch (state.step) {
    case "provider":
      return (
        <StepBox title="① 选择服务商" hint="选择要接入的模型服务">
          <ProviderOptions selected={state.values.provider} inputValue={state.inputValue} />
        </StepBox>
      );

    case "baseUrl":
      return (
        <StepBox title="② API Base URL" hint="输入 OpenAI 兼容的 API 端点地址" defaultValue={baseUrlStepDefault(state)}>
          <PromptRow value={state.inputValue} placeholder="(使用默认值)" cursorEnabled={!isExiting} />
        </StepBox>
      );

    case "apiKey":
      return (
        <StepBox title="③ API Key" hint={apiKeyHint(state)}>
          <PromptRow value={state.inputValue} placeholder="" cursorEnabled={!isExiting} />
        </StepBox>
      );

    case "model":
      return (
        <StepBox title="④ 模型名称" hint="输入要使用的 LLM 模型名称" defaultValue={modelStepDefault(state)}>
          <PromptRow value={state.inputValue} placeholder="(使用默认值)" cursorEnabled={!isExiting} />
        </StepBox>
      );

    case "confirm": {
      return (
        <Box flexDirection="column">
          <Text bold>⑤ 确认配置</Text>
          <Box marginY={1} flexDirection="column">
            <Text>Provider: <Text color="cyan">{state.values.provider}</Text></Text>
            <Text>API Base URL: <Text color="cyan">{state.values.baseUrl}</Text></Text>
            <Text>
              API Key:{" "}
              <Text color="cyan">
                {maskApiKey(state.values.apiKey)}
              </Text>
            </Text>
            <Text>Model: <Text color="cyan">{state.values.model}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>按 Enter 或输入 Y 确认保存</Text>
          </Box>
        </Box>
      );
    }
  }
};

function modelStepDefault(state: SetupWizardState): string {
  return state.values.provider === "codebuddy" ? "deepseek-v4-pro" : DEFAULT_CONFIG.model;
}

function baseUrlStepDefault(state: SetupWizardState): string {
  return state.values.baseUrl;
}

function apiKeyHint(state: SetupWizardState): string {
  return state.values.provider === "codebuddy"
    ? "输入 CodeBuddy 订阅密钥（ck_ 开头）"
    : "输入您的 API 密钥";
}

const PROVIDER_OPTIONS = [
  { key: "1", value: "codebuddy", label: "CodeBuddy", hint: "腾讯代码助手（ck_ 密钥）" },
  { key: "2", value: "deepseek", label: "DeepSeek", hint: "DeepSeek 官方 API" },
] as const;

function selectedProvider(input: string): string | null {
  const normalized = input.trim().toLowerCase();
  const matched = PROVIDER_OPTIONS.find(
    (option) => normalized === option.key || normalized === option.value,
  );
  return matched?.value ?? null;
}

const ProviderOptions = ({
  selected,
  inputValue,
}: {
  selected: string;
  inputValue: string;
}) => {
  const current = selectedProvider(inputValue) ?? selected;
  return (
    <Box flexDirection="column" marginTop={1}>
      {PROVIDER_OPTIONS.map((option) => (
        <Box key={option.value}>
          <Text color={current === option.value ? "green" : "gray"}>
            {current === option.value ? "●" : "○"} [{option.key}] {option.label}
          </Text>
          <Text color="gray" dimColor> — {option.hint}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">输入 1 或 2 选择，回车确认</Text>
      </Box>
    </Box>
  );
};

const StepBox = ({
  title,
  hint,
  defaultValue,
  children,
}: {
  title: string;
  hint: string;
  defaultValue?: string;
  children: React.ReactNode;
}) => (
  <Box flexDirection="column">
    <Text>{title}</Text>
    <Text color="gray" dimColor>{hint}</Text>
    {defaultValue && <Text color="gray">默认: {defaultValue}</Text>}
    {children}
  </Box>
);

const PromptRow = ({
  value,
  placeholder,
  cursorEnabled,
}: {
  value: string;
  placeholder: string;
  cursorEnabled: boolean;
}) => {
  const { setCursorPosition } = useCursor();
  const inputLineRef = useRef<DOMElement | null>(null);
  const [cursorOrigin, setCursorOrigin] = useState<CursorPosition | null>(null);

  useLayoutEffect(() => {
    if (!cursorEnabled || !inputLineRef.current) {
      setCursorOrigin(null);
      return;
    }
    const metrics = measureElement(inputLineRef.current);
    if (metrics) {
      setCursorOrigin({ x: metrics.x, y: metrics.y });
    }
  }, [cursorEnabled, value, placeholder]);

  setCursorPosition(
    cursorEnabled && cursorOrigin
      ? {
          x: cursorOrigin.x + stringWidth(value),
          y: cursorOrigin.y,
        }
      : undefined,
  );

  return (
    <Box marginTop={1}>
      <Text color="green" bold>▸ </Text>
      <Box ref={inputLineRef}>
        {value ? (
          <Text>{value}</Text>
        ) : (
          <Text color="gray" dimColor>{placeholder}</Text>
        )}
      </Box>
    </Box>
  );
};

export default SetupWizard;
