import { useState } from "react";
import { Box, Text } from "ink";
import { getConfig } from "../config/store.js";
import type { AppConfig } from "../config/store.js";
import { getPackageVersion } from "../config/version.js";
import { useChat, useChatInputRouter, useExit } from "./hooks/index.js";
import type { AgentRunner } from "./hooks/index.js";
import InputBox from "./components/InputBox/index.js";
import TranscriptViewport, { useTranscriptViewportController } from "./components/TranscriptViewport/index.js";
import { useInputBoxController } from "./components/InputBox/useInputBoxController.js";
import { appendInputHistory } from "./components/InputBox/inputBoxModel.js";
import SetupWizard from "./SetupWizard.js";
import { useAppLayout } from "./appLayout.js";
import { useConfigurationState } from "./configurationState.js";
import { ContextUsageFooter } from "./ContextUsageFooter.js";
import { handleSlashCommand } from "./slashCommandRunner.js";
import { selectInputTips } from "./inputTips.js";
import AskUserQuestionPrompt from "./AskUserQuestionPrompt.js";

interface AppProps {
  agentRunner?: AgentRunner;
}

const App = ({ agentRunner }: AppProps) => {
  const runtime = useAppRuntime(agentRunner);
  return <AppContent runtime={runtime} />;
};

interface AppRuntime {
  configured: boolean | null;
  completeSetup: () => void;
  config: AppConfig | null;
  layout: ReturnType<typeof useAppLayout>;
  isExiting: boolean;
  exitStatusMessage: string | null;
  isStreaming: boolean;
  pendingQuestion: ChatRuntime["pendingQuestion"];
  submitQuestionAnswers: ChatRuntime["submitQuestionAnswers"];
  dismissQuestion: ChatRuntime["dismissQuestion"];
  entries: ChatRuntime["entries"];
  contextUsage: ReturnType<typeof useChat>["contextUsage"];
  inputController: ReturnType<typeof useInputBoxController>;
  transcriptController: ReturnType<typeof useTranscriptViewportController>;
}

type ChatRuntime = ReturnType<typeof useChat>;
type ExitRuntime = ReturnType<typeof useExit>;

interface SubmitHandlerInput {
  cancelExitConfirmation: () => void;
  appendSystemMessage: (content: string) => void;
  clearChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  startSetup: () => void;
}

function useAppRuntime(agentRunner: AgentRunner | undefined): AppRuntime {
  const [configured, setConfigured] = useConfigurationState();
  const layout = useAppLayout();
  const exit = useExit({ captureInput: configured !== true });
  const chat = useChat({ agentRunner });
  const submission = useSubmitHandler({
    cancelExitConfirmation: exit.cancelExitConfirmation,
    appendSystemMessage: chat.appendSystemMessage,
    clearChat: chat.clearChat,
    sendMessage: chat.sendMessage,
    startSetup: () => setConfigured(false),
  });

  const inputController = useInputBoxController({
    onSubmit: submission.handleSubmit,
    inputHistory: submission.inputHistory,
    inputColumns: layout.inputColumns,
    disabled: configured !== true || chat.isStreaming || chat.pendingQuestion !== null,
    isExiting: exit.isExiting,
  });
  const config = configured === true ? getConfig() : null;
  const transcriptController = useAppTranscriptController({ config, chat, layout });
  useAppInputRouter({ configured, exit, chat, inputController, transcriptController });

  return {
    configured,
    completeSetup: () => setConfigured(true),
    config,
    layout,
    isExiting: exit.isExiting,
    exitStatusMessage: exit.exitStatusMessage,
    isStreaming: chat.isStreaming,
    pendingQuestion: chat.pendingQuestion,
    submitQuestionAnswers: chat.submitQuestionAnswers,
    dismissQuestion: chat.dismissQuestion,
    entries: chat.entries,
    contextUsage: chat.contextUsage,
    inputController,
    transcriptController,
  };
}

function useSubmitHandler(input: SubmitHandlerInput): {
  inputHistory: readonly string[];
  handleSubmit: (text: string) => void;
} {
  const [inputHistory, setInputHistory] = useState<readonly string[]>([]);
  const handleSubmit = (text: string) => {
    input.cancelExitConfirmation();
    setInputHistory((previousHistory) => appendInputHistory(previousHistory, text));
    submitText(text, input);
  };
  return { inputHistory, handleSubmit };
}

function submitText(text: string, handlers: SubmitHandlerInput): void {
  const commandText = text.trim();
  if (commandText.startsWith("/")) {
    handleSlashCommand(commandText, handlers);
    return;
  }
  handlers.sendMessage(text).then();
}

function useAppTranscriptController({
  config,
  chat,
  layout,
}: {
  config: AppConfig | null;
  chat: ChatRuntime;
  layout: ReturnType<typeof useAppLayout>;
}): ReturnType<typeof useTranscriptViewportController> {
  return useTranscriptViewportController({
    header: config ? buildTranscriptHeader(config) : undefined,
    entries: chat.entries,
    streamingReasoning: chat.isStreaming ? chat.streamingReasoning : "",
    streamingAssistantTurn: chat.isStreaming ? chat.streamingAssistantTurn : null,
    width: layout.screenWidth,
    height: layout.transcriptHeight,
  });
}

function buildTranscriptHeader(config: AppConfig) {
  return {
    version: getPackageVersion(),
    model: config.model,
    thinking: config.thinking,
    reasoningEffort: config.reasoningEffort,
    path: process.cwd(),
  };
}

function useAppInputRouter(input: {
  configured: boolean | null;
  exit: ExitRuntime;
  chat: ChatRuntime;
  inputController: ReturnType<typeof useInputBoxController>;
  transcriptController: ReturnType<typeof useTranscriptViewportController>;
}): void {
  useChatInputRouter({
    enabled: input.configured === true && !input.exit.isExiting && input.chat.pendingQuestion === null,
    mouseTrackingEnabled: input.configured === true && !input.exit.isExiting,
    isStreaming: input.chat.isStreaming || input.chat.pendingQuestion !== null,
    isTranscriptPinnedToBottom: input.transcriptController.isPinnedToBottom,
    wheelRows: input.transcriptController.wheelRows,
    requestExit: input.exit.requestExit,
    cancelExitConfirmation: input.exit.cancelExitConfirmation,
    interrupt: input.chat.interrupt,
    scroll: input.transcriptController.scroll,
    select: input.transcriptController.handleSelectEvent,
    handleInput: input.inputController.handleInput,
    handlePaste: input.inputController.handlePaste,
  });
}

function AppContent({ runtime }: { runtime: AppRuntime }) {
  if (runtime.configured === null) {
    return <Box padding={1}><Text color="gray">正在检查配置……</Text></Box>;
  }

  if (!runtime.configured) {
    return (
      <SetupWizard
        onComplete={runtime.completeSetup}
        isExiting={runtime.isExiting}
        exitStatusMessage={runtime.exitStatusMessage}
      />
    );
  }

  if (!runtime.config) {
    return null;
  }

  const tipMessages = selectInputTips({
    entries: runtime.entries,
    isStreaming: runtime.isStreaming,
    inputIsBlank: runtime.inputController.view.isBlank,
  });

  return (
    <Box flexDirection="column" width={runtime.layout.screenWidth} height={runtime.layout.screenHeight}>
      <TranscriptViewport
        height={runtime.transcriptController.height}
        visibleRows={runtime.transcriptController.visibleRows}
        showScrollHint={runtime.transcriptController.showScrollHint}
        selectionRanges={runtime.transcriptController.selectionRanges}
      />

      <Box ref={runtime.layout.footerRef} flexDirection="column">
        {runtime.pendingQuestion ? (
          <AskUserQuestionPrompt
            questions={runtime.pendingQuestion.questions}
            onSubmit={(answers) => void runtime.submitQuestionAnswers(answers)}
            onCancel={runtime.dismissQuestion}
          />
        ) : (
          <InputBox
            view={runtime.inputController.view}
            screenWidth={runtime.layout.screenWidth}
            inputColumns={runtime.layout.inputColumns}
            maxVisibleLines={runtime.layout.maxVisibleInputLines}
            disabled={runtime.isStreaming}
            statusMessage={runtime.exitStatusMessage}
            tipMessages={tipMessages}
            isExiting={runtime.isExiting}
          />
        )}

        <ContextUsageFooter config={runtime.config} contextUsage={runtime.contextUsage} />
      </Box>
    </Box>
  );
}

export default App;
