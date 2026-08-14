import { Box, Static, Text } from "ink";
import type { AssistantTurn } from "../../assistantTurn.js";
import type { ChatEntry, TextChatEntry } from "../../hooks/index.js";
import Header from "../Header/index.js";

const MAX_VISIBLE_MESSAGES = 20;
const ASSISTANT_PREFIX_COLOR = "#f5f5f5";

interface Props {
  entries: ChatEntry[];
  version: string;
  model: string;
  thinking: boolean;
  reasoningEffort: string;
}

export type MessageRowEntry =
  | AssistantTurn
  | Pick<TextChatEntry, "role" | "content" | "toolCall" | "toolResult">;

// Ink 只支持单个 <Static>，且 items 只追加不变。
// 因此把"顶部 Header + 历史消息"合并成一个静态流：Header 是首项，历史消息随后追加。
// 这样 Header 与已完成历史都只渲染一次，不再参与实时区的整树重绘，输入框增长走增量渲染。
type StaticEntry =
  | {
      kind: "header";
      id: "header";
      version: string;
      model: string;
      thinking: boolean;
      reasoningEffort: string;
    }
  | { kind: "message"; id: string; entry: MessageRowEntry };

const ROLE_COLORS: Record<ChatEntry["role"], string | undefined> = {
  system: undefined,
  user: "#f5f5f5",
  assistant: "#f2f2f2",
  thinking: "yellow",
  tool_call: "yellow",
  tool_result: "gray",
  error: "red",
};

const ROLE_BACKGROUND_COLORS: Record<ChatEntry["role"], string | undefined> = {
  system: undefined,
  user: "#373737",
  assistant: undefined,
  thinking: undefined,
  tool_call: undefined,
  tool_result: undefined,
  error: undefined,
};

const ROLE_LABELS: Record<ChatEntry["role"], string> = {
  system: "",
  user: "You",
  assistant: "",
  thinking: "Thinking",
  tool_call: "",
  tool_result: "Result",
  error: "Error",
};

const isAssistantTurn = (entry: MessageRowEntry): entry is AssistantTurn =>
  entry.role === "assistant";

const MessageList = ({ entries, version, model, thinking, reasoningEffort }: Props) => {
  const visible = entries.length > MAX_VISIBLE_MESSAGES
    ? entries.slice(-MAX_VISIBLE_MESSAGES)
    : entries;

  // Header 固定为首项，历史消息随 entries 追加
  const staticItems: StaticEntry[] = [
    {
      kind: "header",
      id: "header",
      version,
      model,
      thinking,
      reasoningEffort,
    },
    ...visible.map(
      (entry): StaticEntry => ({ kind: "message", id: entry.id, entry }),
    ),
  ];

  return (
    <Static items={staticItems}>
      {(item) =>
        item.kind === "header" ? (
          <Header
            key={item.id}
            version={item.version}
            model={item.model}
            thinking={item.thinking}
            reasoningEffort={item.reasoningEffort}
          />
        ) : (
          <MessageRow key={item.id} entry={item.entry} />
        )
      }
    </Static>
  );
};

export const MessageRow = ({ entry }: { entry: MessageRowEntry }) => (
  <Box
    backgroundColor={ROLE_BACKGROUND_COLORS[entry.role]}
    marginTop={0}
    marginBottom={entry.role === "thinking" || entry.role === "user" ? 1 : 0}
    marginLeft={entry.role === "assistant" ? 1 : 0}
  >
    {entry.role === "assistant" ? (
      <Text color={ASSISTANT_PREFIX_COLOR}>● </Text>
    ) : (
      <Text
        color={ROLE_COLORS[entry.role]}
        bold
        dimColor={entry.role === "thinking"}
      >
        {entry.role === "user" ? "❯ " : ROLE_LABELS[entry.role]}
        {entry.role === "thinking" ? ": " : ""}
      </Text>
    )}
    <Box>{renderContent(entry)}</Box>
  </Box>
);

const renderContent = (entry: MessageRowEntry) => {
  if (isAssistantTurn(entry)) {
    return <AssistantTurnContent turn={entry} />;
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

const AssistantTurnContent = ({ turn }: { turn: AssistantTurn }) => (
  <Box flexDirection="column">
    {turn.parts.map((part) => (
      <Box key={part.id} marginLeft={part.kind === "text" ? 0 : 2}>
        <Text color={getAssistantPartColor(part.kind)}>
          {part.content}
        </Text>
      </Box>
    ))}
    {turn.activeText && (
      <Text color={ROLE_COLORS.assistant}>{turn.activeText}</Text>
    )}
  </Box>
);

const getAssistantPartColor = (kind: AssistantTurn["parts"][number]["kind"]): string | undefined => {
  if (kind === "tool") {
    return ROLE_COLORS.tool_call;
  }
  if (kind === "error") {
    return ROLE_COLORS.error;
  }
  return ROLE_COLORS.assistant;
};

const ToolResultContent = ({
  toolResult,
  content,
}: {
  toolResult: TextChatEntry["toolResult"];
  content: string;
}) => (
  <Box flexDirection="column">
    <Text color={toolResult?.result.success ? "green" : "red"}>{content}</Text>
  </Box>
);

export default MessageList;
