import { useState, useCallback, useLayoutEffect, useRef } from "react";
import { Box, Text, useCursor, useInput, usePaste, measureElement } from "ink";
import type { CursorPosition } from "ink";
import stringWidth from "string-width";
import { setConfig, DEFAULT_CONFIG } from "../config/store.js";

type Step = "baseUrl" | "apiKey" | "model" | "confirm";

const STEP_ORDER: Step[] = ["baseUrl", "apiKey", "model", "confirm"];
const STEP_LABELS: Record<Step, string> = {
  baseUrl: "URL",
  apiKey: "Key",
  model: "Model",
  confirm: "确认",
};

interface Props {
  onComplete: () => void;
  isExiting?: boolean;
}

const SetupWizard = ({ onComplete, isExiting = false }: Props) => {
  const [step, setStep] = useState<Step>("baseUrl");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_CONFIG.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_CONFIG.model);
  const [inputValue, setInputValue] = useState("");

  // ref 避免闭包捕获过期值
  const inputRef = useRef(inputValue);
  inputRef.current = inputValue;
  const stepRef = useRef(step);
  stepRef.current = step;
  const baseUrlRef = useRef(baseUrl);
  baseUrlRef.current = baseUrl;
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const modelRef = useRef(model);
  modelRef.current = model;

  const stepIdx = STEP_ORDER.indexOf(step);

  const applyStepValue = useCallback(() => {
    const s = stepRef.current;
    const input = inputRef.current;
    switch (s) {
      case "baseUrl":
        setBaseUrl(input || DEFAULT_CONFIG.baseUrl);
        setStep("apiKey");
        break;
      case "apiKey":
        setApiKey(input);
        setStep("model");
        break;
      case "model":
        setModel(input || DEFAULT_CONFIG.model);
        setStep("confirm");
        break;
      case "confirm":
        setConfig({
          baseUrl: baseUrlRef.current || DEFAULT_CONFIG.baseUrl,
          apiKey: apiKeyRef.current,
          model: modelRef.current || DEFAULT_CONFIG.model,
          models: [modelRef.current || DEFAULT_CONFIG.model],
          thinking: DEFAULT_CONFIG.thinking,
          reasoningEffort: DEFAULT_CONFIG.reasoningEffort,
        });
        onComplete();
        return;
    }
    setInputValue("");
  }, [onComplete]);

  const appendInput = useCallback((input: string) => {
    setInputValue((prev) => prev + input);
  }, []);

  const removeLastInputCharacter = useCallback(() => {
    setInputValue((prev) => Array.from(prev).slice(0, -1).join(""));
  }, []);

  useInput((input, key) => {
    if (stepRef.current === "confirm") {
      if (key.return || input === "y" || input === "Y") {
        applyStepValue();
      }
      return;
    }

    if (key.return) return applyStepValue();
    if (key.backspace || key.delete) return removeLastInputCharacter();
    if (key.ctrl || key.meta || input.length === 0) return;

    appendInput(input);
  }, { isActive: !isExiting });

  usePaste((input) => {
    if (stepRef.current !== "confirm") {
      appendInput(input);
    }
  }, { isActive: !isExiting });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>⚡ cyjcode-cli — 首次配置引导</Text>
      </Box>

      <Box marginBottom={1}>
        {STEP_ORDER.map((s, i) => (
          <Text key={s}>
            <Text color={i <= stepIdx ? "green" : "gray"}>
              {i <= stepIdx ? "●" : "○"} {STEP_LABELS[s]}
            </Text>
            {i < STEP_ORDER.length - 1 && <Text color="gray">{" — "}</Text>}
          </Text>
        ))}
      </Box>

      <Box marginY={1}>
        <Text color="gray" dimColor>{"—".repeat(40)}</Text>
      </Box>

      <StepContent
        step={step}
        inputValue={inputValue}
        baseUrl={baseUrl}
        apiKey={apiKey}
        model={model}
        isExiting={isExiting}
      />

      <Box marginY={1}>
        <Text color="gray">按 Enter 继续</Text>
      </Box>
    </Box>
  );
};

const StepContent = ({
  step,
  inputValue,
  baseUrl,
  apiKey,
  model,
  isExiting,
}: {
  step: Step;
  inputValue: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isExiting: boolean;
}) => {
  switch (step) {
    case "baseUrl":
      return (
        <StepBox title="① API Base URL" hint="输入 OpenAI 兼容的 API 端点地址" defaultValue={DEFAULT_CONFIG.baseUrl}>
          <PromptRow value={inputValue} placeholder="(使用默认值)" cursorEnabled={!isExiting} />
        </StepBox>
      );

    case "apiKey":
      return (
        <StepBox title="② API Key" hint="输入您的 API 密钥">
          <PromptRow value={inputValue} placeholder="" cursorEnabled={!isExiting} />
        </StepBox>
      );

    case "model":
      return (
        <StepBox title="③ 模型名称" hint="输入要使用的 LLM 模型名称" defaultValue={DEFAULT_CONFIG.model}>
          <PromptRow value={inputValue} placeholder="(使用默认值)" cursorEnabled={!isExiting} />
        </StepBox>
      );

    case "confirm":
      return (
        <Box flexDirection="column">
          <Text bold>④ 确认配置</Text>
          <Box marginY={1} flexDirection="column">
            <Text>API Base URL: <Text color="cyan">{baseUrl}</Text></Text>
            <Text>
              API Key:{" "}
              <Text color="cyan">
                {apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : "(未设置)"}
              </Text>
            </Text>
            <Text>Model: <Text color="cyan">{model}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>按 Enter 或输入 Y 确认保存</Text>
          </Box>
        </Box>
      );
  }
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
  const inputLineRef = useRef<any>(null);
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
