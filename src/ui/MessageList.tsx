import React from "react";
import { Box, Text } from "ink";
import type { ChatEntry } from "./useChat.js";

interface Props {
  entries: ChatEntry[];
  streamingText: string;
  isStreaming: boolean;
}

const roleColors: Record<string, string> = {
  user: "green",
  assistant: "cyan",
  tool_call: "yellow",
  tool_result: "gray",
  error: "red",
};

const roleLabels: Record<string, string> = {
  user: "You",
  assistant: "cyjcode",
  tool_call: "Tool",
  tool_result: "Result",
  error: "Error",
};

const MessageList: React.FC<Props> = ({ entries, streamingText, isStreaming }) => {
  // 只显示最近的消息（最多 20 条），从底部截断
  const displayEntries = entries.length > 20
    ? entries.slice(-20)
    : entries;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {displayEntries.length === 0 && !isStreaming && (
        <Box>
          <Text color="gray">输入消息开始对话，输入 /help 查看帮助</Text>
        </Box>
      )}

      {displayEntries.map((entry) => (
        <Box key={entry.id} flexDirection="column" marginBottom={1}>
          <Text color={roleColors[entry.role] || "white"} bold>
            {roleLabels[entry.role] || entry.role}:
          </Text>
          <Box paddingLeft={2}>
            {entry.role === "tool_call" && entry.toolCall ? (
              <Box flexDirection="column">
                <Text color="yellow">{entry.toolCall.name}</Text>
                <Text color="gray" dimColor>
                  {JSON.stringify(entry.toolCall.arguments, null, 2)}
                </Text>
              </Box>
            ) : entry.role === "tool_result" && entry.toolResult ? (
              <Box flexDirection="column">
                {entry.toolResult.result.success ? (
                  <Text color="green">{entry.content}</Text>
                ) : (
                  <Text color="red">{entry.content}</Text>
                )}
              </Box>
            ) : (
              <Text color={roleColors[entry.role] || "white"}>
                {entry.content}
              </Text>
            )}
          </Box>
        </Box>
      ))}

      {isStreaming && streamingText && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="cyan" bold>
            cyjcode:
          </Text>
          <Box paddingLeft={2}>
            <Text color="cyan">{streamingText}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default MessageList;
