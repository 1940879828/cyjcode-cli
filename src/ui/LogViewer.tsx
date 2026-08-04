import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { getTodayLogPath, readLogLines, type LogEntry } from "../utils/logger.js";
import { APP } from "../config/app.js";

const MAX_VISIBLE_LOGS = 30;
const POLL_INTERVAL = 500;

const EVENT_COLORS: Record<string, string> = {
  "session.start": "magenta",
  "session.end": "magenta",
  "llm.request": "blue",
  "llm.response": "cyan",
  "tool.start": "yellow",
  "tool.end": "green",
  error: "red",
};

const LogViewer = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    let offset = 0;

    const filePath = getTodayLogPath();
    // 取文件名，因为 readLogLines 需要的是相对于日志目录的文件名
    const fileName = filePath.split(/[/\\]/).pop()!;

    const poll = () => {
      try {
        const lines = readLogLines(fileName, offset);
        if (lines.length === 0) return;

        const parsed: LogEntry[] = [];
        for (const line of lines) {
          try {
            parsed.push(JSON.parse(line) as LogEntry);
          } catch {
            // 跳过无效行
          }
        }

        if (parsed.length === 0) return;
        offset += lines.length;
        setEntries((prev) => [...prev, ...parsed]);
      } catch {
        // 文件可能还不存在
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>📋 {APP.name} 日志查看器</Text>
        <Text color="gray" dimColor>{" "}— 实时监控日志流</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          {entries.length} 条日志 | 按 Ctrl+C 退出
        </Text>
      </Box>

      <Separator />

      <Box flexDirection="column">
        {entries.length === 0 && (
          <Box>
            <Text color="gray" dimColor>等待日志……</Text>
          </Box>
        )}

        {entries.slice(-MAX_VISIBLE_LOGS).map((entry, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color="gray" dimColor>{timestampToTime(entry.timestamp)} </Text>
              <Text color={EVENT_COLORS[entry.type] || "white"} bold>
                {entry.type}
              </Text>
            </Box>
            <Box paddingLeft={4}>
              <Text color={EVENT_COLORS[entry.type] || "white"}>
                {summarize(entry)}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

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

  switch (entry.type) {
    case "llm.request":
      return `model=${d.model || "?"} messages=${(d.messageCount as number) || 0}`;
    case "llm.response":
      return `tokens=${d.totalTokens || "?"}`;
    case "tool.start":
      return `${d.tool || "?"} args=${d.args ? JSON.stringify(d.args).substring(0, 80) : ""}`;
    case "tool.end":
      return d.success ? "✓ 成功" : `✗ ${d.error || "失败"}`;
    case "error":
      return `${d.message || "未知错误"}`;
    default:
      return JSON.stringify(d).substring(0, 120);
  }
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
