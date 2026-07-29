import { useState, useCallback, useLayoutEffect, useRef } from "react";
import { Box, Text } from "ink";
import { useStdin } from "ink";
import { setConfig, DEFAULT_CONFIG } from "../config/store.js";

// ─── 括号粘贴标记 ──────────────────────────────────

const PASTE_START = "\u001B[200~";
const PASTE_END = "\u001B[201~";

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
}

const SetupWizard = ({ onComplete }: Props) => {
  const [step, setStep] = useState<Step>("baseUrl");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_CONFIG.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_CONFIG.model);
  const [inputValue, setInputValue] = useState("");
  const { stdin, setRawMode } = useStdin();

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
  const pasteRef = useRef({ active: false, chunks: [] as string[] });

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
        });
        onComplete();
        return;
    }
    setInputValue("");
  }, [onComplete]);

  /** 处理解析后的输入字符串 */
  const processInput = (raw: string): void => {
    if (raw.includes("\r")) {
      if (stepRef.current === "confirm") return;
      applyStepValue();
      raw = raw.replace(/\r/g, "");
    }

    const backspaces = (raw.match(/[\b\x7F]/g) ?? []).length;
    const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    if (backspaces > 0) {
      setInputValue((prev) => prev.slice(0, Math.max(0, prev.length - backspaces)));
    }
    if (clean.length > 0) {
      setInputValue((prev) => prev + clean);
    }
  };

  useLayoutEffect(() => {
    if (!stdin) return;

    setRawMode(true);
    process.stdout.write("\u001B[?2004h");

    const handleData = (data: Buffer) => {
      const raw = String(data);

      // 确认页：Y 键确认
      if (stepRef.current === "confirm") {
        const printable = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
        if (printable === "y" || printable === "Y" || raw === "\r") {
          applyStepValue();
        }
        return;
      }

      // ── 括号粘贴处理 ──
      if (raw.includes(PASTE_START)) {
        pasteRef.current.active = true;
        pasteRef.current.chunks = [];
        const after = raw.slice(raw.indexOf(PASTE_START) + PASTE_START.length);
        const endIdx = after.indexOf(PASTE_END);
        if (endIdx !== -1) {
          pasteRef.current.active = false;
          const pasteContent = after.slice(0, endIdx);
          const remaining = after.slice(endIdx + PASTE_END.length);
          if (pasteContent) setInputValue((prev) => prev + pasteContent);
          if (remaining) processInput(remaining);
          return;
        }
        pasteRef.current.chunks.push(after);
        return;
      }

      if (pasteRef.current.active) {
        pasteRef.current.chunks.push(raw);
        const combined = pasteRef.current.chunks.join("");
        const endIdx = combined.indexOf(PASTE_END);
        if (endIdx !== -1) {
          pasteRef.current.active = false;
          const pasteContent = combined.slice(0, endIdx);
          const remaining = combined.slice(endIdx + PASTE_END.length);
          pasteRef.current.chunks = [];
          if (pasteContent) setInputValue((prev) => prev + pasteContent);
          if (remaining) processInput(remaining);
        }
        return;
      }

      // ── 普通输入 ──
      processInput(raw);
    };

    stdin.on("data", handleData);
    return () => {
      stdin.off("data", handleData);
      setRawMode(false);
      process.stdout.write("\u001B[?2004l");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin]);

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
}: {
  step: Step;
  inputValue: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}) => {
  switch (step) {
    case "baseUrl":
      return (
        <StepBox title="① API Base URL" hint="输入 OpenAI 兼容的 API 端点地址" defaultValue={DEFAULT_CONFIG.baseUrl}>
          <PromptRow value={inputValue} placeholder="(使用默认值)" />
        </StepBox>
      );

    case "apiKey":
      return (
        <StepBox title="② API Key" hint="输入您的 API 密钥">
          <PromptRow value={inputValue} placeholder="" />
        </StepBox>
      );

    case "model":
      return (
        <StepBox title="③ 模型名称" hint="输入要使用的 LLM 模型名称" defaultValue={DEFAULT_CONFIG.model}>
          <PromptRow value={inputValue} placeholder="(使用默认值)" />
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

const PromptRow = ({ value, placeholder }: { value: string; placeholder: string }) => (
  <Box marginTop={1}>
    <Text color="green" bold>▸ </Text>
    <Text>{value || placeholder}</Text>
    <Text color="gray">|</Text>
  </Box>
);

export default SetupWizard;
