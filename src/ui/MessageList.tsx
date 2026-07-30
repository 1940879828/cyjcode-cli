import { Box, Text } from "ink";
import type { ChatEntry } from "./useChat.js";

const MAX_VISIBLE_MESSAGES = 20;

interface Props {
  entries: ChatEntry[];
  streamingText: string;
  streamingReasoning: string;
  isStreaming: boolean;
}

const ROLE_COLORS: Record<ChatEntry["role"], string> = {
  user: "green",
  assistant: "cyan",
  thinking: "yellow",
  tool_call: "yellow",
  tool_result: "gray",
  error: "red",
};

const ROLE_LABELS: Record<ChatEntry["role"], string> = {
  user: "You",
  assistant: "cyjcode",
  thinking: "Thinking",
  tool_call: "Tool",
  tool_result: "Result",
  error: "Error",
};

const MessageList = ({ entries, streamingText, streamingReasoning, isStreaming }: Props) => {
  const visible = entries.length > MAX_VISIBLE_MESSAGES
    ? entries.slice(-MAX_VISIBLE_MESSAGES)
    : entries;

  return (
    <Box flexDirection="column">
      {visible.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}

      {isStreaming && streamingReasoning && (
        <Box flexDirection="column">
          <Text color="yellow" dimColor bold>Thinking:</Text>
          <Box paddingLeft={2}>
            <Text color="yellow" dimColor>{streamingReasoning}</Text>
          </Box>
        </Box>
      )}

      {isStreaming && streamingText && (
        <Box flexDirection="column">
          <Text color="cyan" bold>cyjcode:</Text>
          <Box paddingLeft={2}>
            <Text color="cyan">{streamingText}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const EntryRow = ({ entry }: { entry: ChatEntry }) => (
  <Box flexDirection="column" >
    <Text
      color={ROLE_COLORS[entry.role]}
      bold
      dimColor={entry.role === "thinking"}
    >
      {ROLE_LABELS[entry.role]}:
    </Text>
    <Box paddingLeft={2}>{renderContent(entry)}</Box>
  </Box>
);

const renderContent = (entry: ChatEntry) => {
  if (entry.role === "tool_call" && entry.toolCall) {
    return <ToolCallContent toolCall={entry.toolCall} />;
  }
  if (entry.role === "tool_result" && entry.toolResult) {
    return <ToolResultContent toolResult={entry.toolResult} content={entry.content} />;
  }
  return (
    <Text color={ROLE_COLORS[entry.role]} dimColor={entry.role === "thinking"}>
      {entry.content}
    </Text>
  );
};

const ToolCallContent = ({ toolCall }: { toolCall: ChatEntry["toolCall"] }) => (
  <Box flexDirection="column">
    <Text color="yellow">{toolCall?.name}</Text>
    <Text color="gray" dimColor>
      {toolCall?.arguments ? JSON.stringify(toolCall.arguments, null, 2) : ""}
    </Text>
  </Box>
);

const ToolResultContent = ({
  toolResult,
  content,
}: {
  toolResult: ChatEntry["toolResult"];
  content: string;
}) => (
  <Box flexDirection="column">
    <Text color={toolResult?.result.success ? "green" : "red"}>{content}</Text>
  </Box>
);

export default MessageList;
