import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { hasConfig, getConfig } from "../config/store.js";
import { useChat } from "./useChat.js";
import { useExit } from "./useExit.js";
import MessageList from "./MessageList.js";
import InputBox from "./InputBox.js";
import { matchCommand } from "./commands.js";
import SetupWizard from "./SetupWizard.js";
import Header from "./components/Header.js";
import pkg from "../../package.json" with { type: "json" };

/**
 * 命令输出自动清除的延迟（毫秒）。
 * 设置一个较长值以避免 key 警告，实际 UI 中消息会自然上移。
 */
const COMMAND_FADE_DELAY = 10_000;

const App = () => {
  /** 配置是否就绪：null 检查中 / false 需引导 / true 已就绪 */
  const [configured, setConfigured] = useState<boolean | null>(null);
  /** 命令输出的临时提示文本，超时后自动清除 */
  const [commandOutput, setCommandOutput] = useState<string | null>(null);
  /** 退出流程：isExiting 供其他组件消费，requestExit 触发退出 */
  const { isExiting } = useExit();
  /** 聊天状态与操作 */
  const { entries, isStreaming, streamingText, streamingReasoning, sendMessage, clearChat } = useChat();

  useEffect(() => {
    setConfigured(hasConfig());
  }, []);

  const handleCommand = (text: string): boolean => {
    const cmd = matchCommand(text);
    if (!cmd) return false;

    if (cmd.name === "/clear") {
      clearChat();
      setCommandOutput("对话历史已清空");
    } else {
      setCommandOutput(cmd.handler());
    }
    setTimeout(() => setCommandOutput(null), COMMAND_FADE_DELAY);
    return true;
  };

  const handleSubmit = (text: string) => {
    // 拦截所有 / 开头输入：未识别命令不给 AI，防止配置错误时触发 API 调用
    if (text.startsWith("/")) {
      if (text.trim() === "/setup") {
        setConfigured(false);
        return;
      }
      if (handleCommand(text)) return;
      setCommandOutput(`未知命令: ${text}\n输入 /help 查看可用命令`);
      setTimeout(() => setCommandOutput(null), COMMAND_FADE_DELAY);
      return;
    }
    setCommandOutput(null);
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

  return (
    <Box flexDirection="column">
      <Header
        version={pkg.version}
        model={config.model}
        thinking={config.thinking}
        reasoningEffort={config.reasoningEffort}
      />

      {commandOutput && (
        <Box marginY={0} paddingX={1} borderStyle="single">
          <Text color="gray">{commandOutput}</Text>
        </Box>
      )}

      {entries.length > 0 && (
        <Box paddingX={1}>
          <MessageList entries={entries} streamingText={streamingText} streamingReasoning={streamingReasoning} isStreaming={isStreaming} />
        </Box>
      )}

      <InputBox onSubmit={handleSubmit} disabled={isStreaming} isExiting={isExiting} />

      <Box paddingX={1} >
        <Text color="gray" dimColor>
          /help 帮助 | /config 配置 | /clear 清空 | /setup 重配 | Ctrl+C 退出
        </Text>
      </Box>
    </Box>
  );
};

export default App;
