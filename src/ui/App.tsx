import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { hasConfig, getConfig } from "../config/store.js";
import { useChat, useExit } from "./hooks/index.js";
import MessageList, { MessageRow } from "./components/MessageList/index.js";
import InputBox from "./components/InputBox/index.js";
import { appendInputHistory } from "./components/InputBox/inputBoxModel.js";
import { selectContextUsageView } from "./contextUsage.js";
import { parseSlashInput } from "./commands.js";
import SetupWizard from "./SetupWizard.js";
import pkg from "../../package.json" with { type: "json" };

const App = () => {
  /** 配置是否就绪：null 检查中 / false 需引导 / true 已就绪 */
  const [configured, setConfigured] = useState<boolean | null>(null);
  /** 退出流程：isExiting 供其他组件消费，requestExit 触发退出 */
  const { isExiting } = useExit();
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

  const config = getConfig();
  const contextUsageView = selectContextUsageView(contextUsage, config.model);

  return (
    <Box flexDirection="column">
      {/* Header + 历史消息统一放进 <Static>：只渲染一次，之后增量追加，不参与实时区整树重绘 */}
      <MessageList
        entries={entries}
        version={pkg.version}
        model={config.model}
        thinking={config.thinking}
        reasoningEffort={config.reasoningEffort}
      />

      {/* 实时区：流式中持续变化的内容 + 输入框 + 帮助栏 */}
      {isStreaming && streamingReasoning && (
        <MessageRow entry={{ role: "thinking", content: streamingReasoning }} />
      )}
      {isStreaming && streamingAssistantTurn && (
        <MessageRow entry={streamingAssistantTurn} />
      )}

      <InputBox
        onSubmit={handleSubmit}
        inputHistory={inputHistory}
        disabled={isStreaming}
        isExiting={isExiting}
      />

      <Box paddingX={1} >
        {contextUsageView && (
          <>
            <Text color="gray" dimColor> | </Text>
            <Text color={contextUsageView.color} dimColor={contextUsageView.color === "gray"}>
              {contextUsageView.text}
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
};

export default App;
