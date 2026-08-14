import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { getTodayLogPath, readLogLines, type LogEntry } from "../utils/logger.js";
import { APP } from "../config/app.js";
import { useTerminalTitle } from "./hooks/index.js";

const MAX_VISIBLE_LOGS = 30;
const POLL_INTERVAL = 500;

const EVENT_COLORS: Record<string, string> = {
  "session.start": "magenta",
  "session.end": "magenta",
  "llm.request": "blue",
  "llm.reasoning_delta": "yellow",
  "llm.response": "cyan",
  "tool.start": "yellow",
  "tool.end": "green",
  error: "red",
};

const EVENT_SUMMARIZERS: Record<string, (data: Record<string, unknown>) => string> = {
  "llm.request": (data) => `model=${data.model || "?"} messages=${(data.messageCount as number) || 0}`,
  "llm.reasoning_delta": (data) => `len=${data.length || 0} ${data.preview || ""}`,
  "llm.response": (data) =>
    `tokens=${data.totalTokens || "?"} reasoning=${data.reasoningLength || 0}/${data.reasoningDeltaCount || 0}`,
  "tool.start": (data) => `${data.tool || "?"} args=${data.args ? JSON.stringify(data.args).substring(0, 80) : ""}`,
  "tool.end": (data) => data.success ? "✓ 成功" : `✗ ${data.error || "失败"}`,
  error: (data) => `${data.message || "未知错误"}`,
};

interface LogBatch {
  entries: LogEntry[];
  nextOffset: number;
}

interface LogEntryRowProps {
  entry: LogEntry;
}

const LogViewer = () => {
  useTerminalTitle(`${APP.terminalTitle} Logs`);
  const entries = useLogEntries();

  return (
    <Box flexDirection="column" padding={1}>
      <LogHeader />
      <LogStatus count={entries.length} />
      <Separator />
      <LogEntries entries={entries} />
    </Box>
  );
};

function useLogEntries(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    let offset = 0;
    const fileName = getTodayLogFileName();
    const poll = () => {
      const batch = readLogBatch(fileName, offset);
      if (!batch) return;
      offset = batch.nextOffset;
      setEntries((currentEntries) => [...currentEntries, ...batch.entries]);
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return entries;
}

function getTodayLogFileName(): string {
  return getTodayLogPath().split(/[/\\]/).pop()!;
}

function readLogBatch(fileName: string, offset: number): LogBatch | null {
  try {
    const lines = readLogLines(fileName, offset);
    if (lines.length === 0) return null;

    const entries = parseLogLines(lines);
    if (entries.length === 0) return null;

    return { entries, nextOffset: offset + lines.length };
  } catch {
    return null;
  }
}

function parseLogLines(lines: readonly string[]): LogEntry[] {
  return lines.flatMap((line) => {
    const entry = parseLogLine(line);
    return entry ? [entry] : [];
  });
}

function parseLogLine(line: string): LogEntry | null {
  try {
    return JSON.parse(line) as LogEntry;
  } catch {
    return null;
  }
}

const LogHeader = () => (
  <Box marginBottom={1}>
    <Text color="cyan" bold>📋 {APP.name} 日志查看器</Text>
    <Text color="gray" dimColor>{" "}— 实时监控日志流</Text>
  </Box>
);

const LogStatus = ({ count }: { count: number }) => (
  <Box marginBottom={1}>
    <Text color="gray">
      {count} 条日志 | 按 Ctrl+C 退出
    </Text>
  </Box>
);

const LogEntries = ({ entries }: { entries: readonly LogEntry[] }) => (
  <Box flexDirection="column">
    {entries.length === 0 && (
      <Box>
        <Text color="gray" dimColor>等待日志……</Text>
      </Box>
    )}

    {entries.slice(-MAX_VISIBLE_LOGS).map((entry, index) => (
      <LogEntryRow key={index} entry={entry} />
    ))}
  </Box>
);

const LogEntryRow = ({ entry }: LogEntryRowProps) => (
  <Box flexDirection="column" marginBottom={1}>
    <Box>
      <Text color="gray" dimColor>{timestampToTime(entry.timestamp)} </Text>
      <Text color={getEventColor(entry)} bold>
        {entry.type}
      </Text>
    </Box>
    <Box paddingLeft={4}>
      <Text color={getEventColor(entry)}>
        {summarize(entry)}
      </Text>
    </Box>
  </Box>
);

function getEventColor(entry: LogEntry): string {
  return EVENT_COLORS[entry.type] || "white";
}

/** 将 ISO 时间戳转为 HH:MM:SS */
function timestampToTime(ts: string): string {
  try {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
  } catch {
    return ts;
  }
}

/** 将日志条目压缩为一行摘要 */
function summarize(entry: LogEntry): string {
  const d = entry.data;
  if (!d || Object.keys(d).length === 0) return "";
  return EVENT_SUMMARIZERS[entry.type]?.(d) ?? JSON.stringify(d).substring(0, 120);
}

/** 日志查看器中的水平分隔线 */
const Separator = () => (
  <Box marginY={1}>
    <Text color="gray" dimColor>
      {"—".repeat(Math.max(10, (process.stdout.columns || 80) - 2))}
    </Text>
  </Box>
);

export default LogViewer;
