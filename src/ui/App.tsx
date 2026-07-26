import React, { useState, useCallback, useEffect } from "react";
import { Box, Text } from "ink";
import { hasConfig } from "../config/store.js";
import { useChat } from "./useChat.js";
import MessageList from "./MessageList.js";
import InputBox from "./InputBox.js";
import { matchCommand } from "./commands.js";
import SetupWizard from "./SetupWizard.js";

const App: React.FC = () => {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    setConfigured(hasConfig());
  }, []);

  const { entries, isStreaming, streamingText, sendMessage, clearChat } = useChat();
  const [commandOutput, setCommandOutput] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (text: string) => {
      // 检查斜杠命令
      const cmd = matchCommand(text);
      if (cmd) {
        if (cmd.name === "/clear") {
          clearChat();
          setCommandOutput("对话历史已清空");
        } else {
          const output = cmd.handler();
          setCommandOutput(output);
        }
        // 3 秒后清除命令输出
        setTimeout(() => setCommandOutput(null), 3000);
        return;
      }

      // 普通消息
      setCommandOutput(null);
      sendMessage(text);
    },
    [sendMessage, clearChat]
  );

  // 配置检查中
  if (configured === null) {
    return (
      <Box padding={1}>
        <Text color="gray">正在检查配置……</Text>
      </Box>
    );
  }

  // 未配置 → 显示引导
  if (!configured) {
    return (
      <SetupWizard
        onComplete={() => {
          setConfigured(true);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* 标题栏 */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          ⚡ cyjcode-cli v0.1
        </Text>
        <Text color="gray" dimColor>
          {" "}
          — 终端 AI 编程助手
        </Text>
      </Box>

      {/* 命令输出 */}
      {commandOutput && (
        <Box marginY={1} padding={1} borderStyle="single">
          <Text color="gray">{commandOutput}</Text>
        </Box>
      )}

      {/* 消息列表 */}
      <MessageList
        entries={entries}
        streamingText={streamingText}
        isStreaming={isStreaming}
      />

      {/* 分隔线 */}
      <Box marginY={1}>
        <Text color="gray" dimColor>
          {"─".repeat(
            Math.max(10, (process.stdout.columns || 80) - 2)
          )}
        </Text>
      </Box>

      {/* 输入框 */}
      <InputBox onSubmit={handleSubmit} disabled={isStreaming} />

      {/* 提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          /help 帮助 | /config 配置 | /clear 清空 | Ctrl+C 退出
        </Text>
      </Box>
    </Box>
  );
};

export default App;
