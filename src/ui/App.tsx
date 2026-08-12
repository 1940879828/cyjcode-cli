import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Box, Text, measureElement, useWindowSize } from "ink";
import type { DOMElement } from "ink";
import { hasConfig, getConfig } from "../config/store.js";
import { useChat, useChatInputRouter, useExit } from "./hooks/index.js";
import InputBox, {
  getInputColumns,
  getMaxVisibleInputLines,
} from "./components/InputBox/index.js";
import TranscriptViewport, { useTranscriptViewportController } from "./components/TranscriptViewport/index.js";
import { useInputBoxController } from "./components/InputBox/useInputBoxController.js";
import { appendInputHistory } from "./components/InputBox/inputBoxModel.js";
import { selectContextUsageView } from "./contextUsage.js";
import { parseSlashInput } from "./commands.js";
import SetupWizard from "./SetupWizard.js";
import pkg from "../../package.json" with { type: "json" };

const FALLBACK_FOOTER_HEIGHT = 4;

const App = () => {
  /** 配置是否就绪：null 检查中 / false 需引导 / true 已就绪 */
  const [configured, setConfigured] = useState<boolean | null>(null);
  const { columns, rows } = useWindowSize();
  const footerRef = useRef<DOMElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(FALLBACK_FOOTER_HEIGHT);
  /** 退出流程：isExiting 供其他组件消费，requestExit 触发退出 */
  const { isExiting, requestExit } = useExit({ captureInput: configured !== true });
  const [inputHistory, setInputHistory] = useState<readonly string[]>([]);
  /** 聊天状态与操作 */
  const {
    entries,
    isStreaming,
    streamingAssistantTurn,
    streamingReasoning,
    contextUsage,
    sendMessage,
    clearChat,
    appendSystemMessage,
  } = useChat();

  useEffect(() => {
    setConfigured(hasConfig());
  }, []);

  useLayoutEffect(() => {
    if (footerRef.current) {
      setFooterHeight(measureElement(footerRef.current).height);
    }
  });

  const screenWidth = columns || process.stdout.columns || 80;
  const screenHeight = rows || process.stdout.rows || 24;
  const inputColumns = getInputColumns(screenWidth);
  const maxVisibleInputLines = getMaxVisibleInputLines(screenHeight);
  const transcriptHeight = Math.max(
    1,
    screenHeight - footerHeight,
  );

  const handleSubmit = (text: string) => {
    // 用户提交的内容
    const commandText = text.trim();
    // 把用户提交的内容记进历史
    setInputHistory((previousHistory) =>
      appendInputHistory(previousHistory, text),
    );

    // 拦截 trim 后 / 开头的输入：未识别命令不给 AI，防止配置错误时触发 API 调用
    if (commandText.startsWith("/")) {
      const parsed = parseSlashInput(commandText);
      if (parsed) {
        const ctx = {
          clearChat,
          startSetup: () => setConfigured(false),
        };
        appendSystemMessage(parsed.command.handler(parsed.args, ctx));
      } else {
        appendSystemMessage(`未知命令: ${commandText}\n输入 /help 查看可用命令`);
      }
      return;
    }
    sendMessage(text);
  };

  const inputController = useInputBoxController({
    onSubmit: handleSubmit,
    inputHistory,
    inputColumns,
    disabled: configured !== true || isStreaming,
    isExiting,
  });
  const config = configured === true ? getConfig() : null;
  const transcriptController = useTranscriptViewportController({
    header: config
      ? {
          version: pkg.version,
          model: config.model,
          thinking: config.thinking,
          reasoningEffort: config.reasoningEffort,
          path: process.cwd(),
        }
      : undefined,
    entries,
    streamingReasoning: isStreaming ? streamingReasoning : "",
    streamingAssistantTurn: isStreaming ? streamingAssistantTurn : null,
    width: screenWidth,
    height: transcriptHeight,
  });

  useChatInputRouter({
    enabled: configured === true && !isExiting,
    mouseTrackingEnabled: isStreaming,
    isStreaming,
    isTranscriptPinnedToBottom: transcriptController.isPinnedToBottom,
    wheelRows: transcriptController.wheelRows,
    requestExit,
    scroll: transcriptController.scroll,
    handleInput: inputController.handleInput,
    handlePaste: inputController.handlePaste,
  });

  if (configured === null) {
    return (
      <Box padding={1}>
        <Text color="gray">正在检查配置……</Text>
      </Box>
    );
  }

  if (!configured) {
    return <SetupWizard onComplete={() => setConfigured(true)} isExiting={isExiting} />;
  }

  if (!config) {
    return null;
  }

  const contextUsageView = selectContextUsageView(contextUsage, config.model);

  return (
    <Box flexDirection="column" width={screenWidth} height={screenHeight}>
      <TranscriptViewport
        height={transcriptController.height}
        visibleRows={transcriptController.visibleRows}
        showScrollHint={transcriptController.showScrollHint}
      />

      <Box ref={footerRef} flexDirection="column">
        <InputBox
          view={inputController.view}
          screenWidth={screenWidth}
          inputColumns={inputColumns}
          maxVisibleLines={maxVisibleInputLines}
          disabled={isStreaming}
          isExiting={isExiting}
        />

        <Box paddingX={1} height={1}>
          {contextUsageView ? (
            <>
              {contextUsageView.bar ? (
                <>
                  <Text color="gray" dimColor>{contextUsageView.text} </Text>
                  <Text backgroundColor={contextUsageView.bar.usedBackgroundColor}>
                    {contextUsageView.bar.used}
                  </Text>
                  <Text backgroundColor={contextUsageView.bar.unusedBackgroundColor}>
                    {contextUsageView.bar.unused}
                  </Text>
                  <Text color="gray" dimColor>{` ${contextUsageView.bar.suffix}`}</Text>
                </>
              ) : (
                <Text color={contextUsageView.color} dimColor={contextUsageView.color === "gray"}>
                  {contextUsageView.text}
                </Text>
              )}
            </>
          ) : (
            <Text> </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default App;
