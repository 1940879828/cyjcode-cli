import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Box, Text, measureElement, useWindowSize } from "ink";
import type { DOMElement } from "ink";
import { hasConfig, getConfig } from "../config/store.js";
import type { AppConfig } from "../config/store.js";
import { getPackageVersion } from "../config/version.js";
import { useChat, useChatInputRouter, useExit } from "./hooks/index.js";
import type { AgentRunner } from "./hooks/index.js";
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

const FALLBACK_FOOTER_HEIGHT = 4;

interface AppProps {
  agentRunner?: AgentRunner;
}

const App = ({ agentRunner }: AppProps) => {
  const [configured, setConfigured] = useConfigurationState();
  const { columns, rows } = useWindowSize();
  const footerRef = useRef<DOMElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(FALLBACK_FOOTER_HEIGHT);
  const { isExiting, requestExit } = useExit({ captureInput: configured !== true });
  const [inputHistory, setInputHistory] = useState<readonly string[]>([]);
  const {
    entries,
    isStreaming,
    streamingAssistantTurn,
    streamingReasoning,
    contextUsage,
    sendMessage,
    clearChat,
    appendSystemMessage,
  } = useChat({ agentRunner });

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
    const commandText = text.trim();
    setInputHistory((previousHistory) =>
      appendInputHistory(previousHistory, text),
    );

    if (commandText.startsWith("/")) {
      handleSlashCommand(commandText, {
        appendSystemMessage,
        clearChat,
        sendMessage,
        startSetup: () => setConfigured(false),
      });
      return;
    }
    sendMessage(text).then();
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
          version: getPackageVersion(),
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

        <ContextUsageFooter config={config} contextUsage={contextUsage} />
      </Box>
    </Box>
  );
};

function useConfigurationState(): [
  boolean | null,
  Dispatch<SetStateAction<boolean | null>>,
] {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    setConfigured(hasConfig());
  }, []);
  return [configured, setConfigured];
}

interface SlashCommandHandlers {
  appendSystemMessage: (content: string) => void;
  clearChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  startSetup: () => void;
}

function handleSlashCommand(
  commandText: string,
  handlers: SlashCommandHandlers,
): void {
  const parsed = parseSlashInput(commandText);
  if (!parsed) {
    handlers.appendSystemMessage(`未知命令: ${commandText}\n输入 /help 查看可用命令`);
    return;
  }

  if (parsed.command.execution === "agent") {
    void handlers.sendMessage(parsed.command.name);
    return;
  }

  handlers.appendSystemMessage(parsed.command.handler(parsed.args, {
    clearChat: handlers.clearChat,
    startSetup: handlers.startSetup,
  }));
}

function ContextUsageFooter({
  config,
  contextUsage,
}: {
  config: AppConfig;
  contextUsage: Parameters<typeof selectContextUsageView>[0];
}) {
  const contextUsageView = selectContextUsageView(contextUsage, config.model);
  if (!contextUsageView) {
    return <Box paddingX={1} height={1}><Text> </Text></Box>;
  }
  return (
    <Box paddingX={1} height={1}>
      {contextUsageView.bar
        ? <ContextUsageBar view={contextUsageView} />
        : (
          <Text color={contextUsageView.color} dimColor={contextUsageView.color === "gray"}>
            {contextUsageView.text}
          </Text>
        )}
    </Box>
  );
}

function ContextUsageBar({
  view,
}: {
  view: NonNullable<ReturnType<typeof selectContextUsageView>>;
}) {
  if (!view.bar) return null;
  return (
    <>
      <Text color="gray" dimColor>{view.text} </Text>
      <Text backgroundColor={view.bar.usedBackgroundColor}>{view.bar.used}</Text>
      <Text backgroundColor={view.bar.unusedBackgroundColor}>{view.bar.unused}</Text>
      <Text color="gray" dimColor>{` ${view.bar.suffix}`}</Text>
    </>
  );
}

export default App;
