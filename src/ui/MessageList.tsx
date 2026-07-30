import { Box, Text } from "ink";
import type { ChatEntry } from "./useChat.js";

const MAX_VISIBLE_MESSAGES = 20;

interface Props {
  entries: ChatEntry[];
  streamingText: string;
  streamingReasoning: string;
  isStreaming: boolean;
}

type MessageRowEntry = Pick<
  ChatEntry,
  "role" | "content" | "toolCall" | "toolResult"
>;

const ROLE_COLORS: Record<ChatEntry["role"], string | undefined> = {
  user: "#505050",
  assistant: undefined,
  thinking: "yellow",
  tool_call: "yellow",
  tool_result: "gray",
  error: "red",
};

const ROLE_BACKGROUND_COLORS: Record<ChatEntry["role"], string | undefined> = {
  user: "#373737",
  assistant: undefined,
  thinking: undefined,
  tool_call: undefined,
  tool_result: undefined,
  error: undefined,
};

const ROLE_LABELS: Record<ChatEntry["role"], string> = {
  user: "You",
  assistant: "",
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
        <MessageRow key={entry.id} entry={entry} />
      ))}

      {isStreaming && streamingReasoning && (
        <MessageRow
          entry={{ role: "thinking", content: streamingReasoning }}
        />
      )}

      {isStreaming && streamingText && (
        <MessageRow entry={{ role: "assistant", content: streamingText }} />
      )}
    </Box>
  );
};

const MessageRow = ({ entry }: { entry: MessageRowEntry }) => (
  <Box backgroundColor={ROLE_BACKGROUND_COLORS[entry.role]}>
    <Text
      color={ROLE_COLORS[entry.role]}
      bold
      dimColor={entry.role === "thinking"}
    >
      {entry.role === "user" ? "❯ " : ROLE_LABELS[entry.role]}
      {entry.role === "thinking" ? ": " : ""}
    </Text>
    <Box>{renderContent(entry)}</Box>
  </Box>
);

const renderContent = (entry: MessageRowEntry) => {
  if (entry.role === "tool_call" && entry.toolCall) {
    return <ToolCallContent toolCall={entry.toolCall} />;
  }
  if (entry.role === "tool_result" && entry.toolResult) {
    return <ToolResultContent toolResult={entry.toolResult} content={entry.content} />;
  }
  const color = entry.role === "user" ? "gray" : ROLE_COLORS[entry.role];
  return (
    <Text color={color} dimColor={entry.role === "thinking"}>
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
