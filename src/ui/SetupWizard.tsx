import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import type { CyjConfig } from "../config/store.js";
import { setConfig, getConfig } from "../config/store.js";

interface Props {
  onComplete: () => void;
}

type Step = "baseUrl" | "apiKey" | "model" | "confirm";

const stepOrder: Step[] = ["baseUrl", "apiKey", "model", "confirm"];

const SetupWizard: React.FC<Props> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<Step>("baseUrl");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [inputValue, setInputValue] = useState("");
  const [showMasked, setShowMasked] = useState(false);

  const stepIndex = stepOrder.indexOf(currentStep);

  const saveAndNext = useCallback(() => {
    switch (currentStep) {
      case "baseUrl":
        setBaseUrl(inputValue || "https://api.openai.com/v1");
        setCurrentStep("apiKey");
        break;
      case "apiKey":
        setApiKey(inputValue);
        setCurrentStep("model");
        break;
      case "model":
        setModel(inputValue || "gpt-4o");
        setCurrentStep("confirm");
        break;
      case "confirm":
        // 保存配置
        const config: CyjConfig = {
          baseUrl: baseUrl || "https://api.openai.com/v1",
          apiKey,
          model: model || "gpt-4o",
        };
        setConfig(config);
        onComplete();
        return;
    }
    setInputValue("");
    setShowMasked(false);
  }, [currentStep, inputValue, baseUrl, apiKey, model, onComplete]);

  useInput(
    useCallback(
      (inputChar: string, key: { return: boolean; backspace: boolean; delete: boolean; tab: boolean }) => {
        // 确认步骤特殊处理
        if (currentStep === "confirm") {
          if (key.return) {
            saveAndNext();
          } else if (inputChar.toLowerCase() === "y") {
            saveAndNext();
          }
          return;
        }

        if (key.return) {
          saveAndNext();
        } else if (key.backspace || key.delete) {
          setInputValue((prev) => prev.slice(0, -1));
        } else if (key.tab) {
          // Tab 切换密码显示
          if (currentStep === "apiKey") {
            setShowMasked((prev) => !prev);
          }
        } else {
          if (inputChar && inputChar.length === 1 && inputChar.charCodeAt(0) >= 32) {
            setInputValue((prev) => prev + inputChar);
          }
        }
      },
      [currentStep, saveAndNext]
    )
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          ⚡ cyjcode-cli — 首次配置引导
        </Text>
      </Box>

      {/* 步骤指示器 */}
      <Box marginBottom={1}>
        {stepOrder.map((step, i) => (
          <React.Fragment key={step}>
            <Text color={i <= stepIndex ? "green" : "gray"}>
              {i <= stepIndex ? "●" : "○"} {getLabel(step)}
            </Text>
            {i < stepOrder.length - 1 && (
              <Text color="gray">{" — "}</Text>
            )}
          </React.Fragment>
        ))}
      </Box>

      <Box marginY={1}>
        <Text color="gray" dimColor>
          {"—".repeat(40)}
        </Text>
      </Box>

      {/* 当前步骤内容 */}
      {currentStep === "baseUrl" && (
        <Box flexDirection="column">
          <Text>① API Base URL</Text>
          <Text color="gray" dimColor>
            输入 OpenAI 兼容的 API 端点地址
          </Text>
          <Text color="gray">默认: https://api.openai.com/v1</Text>
          <Box marginTop={1}>
            <Text color="green" bold>
              ▸{" "}
            </Text>
            <Text>{inputValue || "(使用默认值)"}</Text>
            <Text color="gray">|</Text>
          </Box>
        </Box>
      )}

      {currentStep === "apiKey" && (
        <Box flexDirection="column">
          <Text>② API Key</Text>
          <Text color="gray" dimColor>
            输入您的 API 密钥（输入时不会显示明文）
          </Text>
          {showMasked && (
            <Text color="gray">密钥将可见</Text>
          )}
          <Box marginTop={1}>
            <Text color="green" bold>
              ▸{" "}
            </Text>
            <Text>
              {showMasked
                ? inputValue
                : inputValue
                    ? "*".repeat(inputValue.length)
                    : ""}
            </Text>
            <Text color="gray">|</Text>
          </Box>
          {inputValue.length > 0 && (
            <Text color="gray" dimColor>
              Tab 切换显示/隐藏
            </Text>
          )}
        </Box>
      )}

      {currentStep === "model" && (
        <Box flexDirection="column">
          <Text>③ 模型名称</Text>
          <Text color="gray" dimColor>
            输入要使用的 LLM 模型名称
          </Text>
          <Text color="gray">默认: gpt-4o</Text>
          <Box marginTop={1}>
            <Text color="green" bold>
              ▸{" "}
            </Text>
            <Text>{inputValue || "(使用默认值)"}</Text>
            <Text color="gray">|</Text>
          </Box>
        </Box>
      )}

      {currentStep === "confirm" && (
        <Box flexDirection="column">
          <Text bold>④ 确认配置</Text>
          <Box marginY={1} flexDirection="column">
            <Text>
              API Base URL:{" "}
              <Text color="cyan">{baseUrl}</Text>
            </Text>
            <Text>
              API Key:{" "}
              <Text color="cyan">
                {apiKey
                  ? apiKey.slice(0, 8) + "..." + apiKey.slice(-4)
                  : "(未设置)"}
              </Text>
            </Text>
            <Text>
              Model: <Text color="cyan">{model}</Text>
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="green" bold>
              按 Enter 或输入 Y 确认保存
            </Text>
          </Box>
        </Box>
      )}

      <Box marginY={1}>
        <Text color="gray">按 Enter 继续</Text>
      </Box>
    </Box>
  );
};

function getLabel(step: Step): string {
  switch (step) {
    case "baseUrl": return "URL";
    case "apiKey": return "Key";
    case "model": return "Model";
    case "confirm": return "确认";
  }
}

export default SetupWizard;
