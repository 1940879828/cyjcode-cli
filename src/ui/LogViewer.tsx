import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import { getTodayLogPath, readLogLines, type LogEntry } from "../utils/logger.js";

const eventColors: Record<string, string> = {
  "session.start": "magenta",
  "session.end": "magenta",
  "llm.request": "blue",
  "llm.response": "cyan",
  "tool.start": "yellow",
  "tool.end": "green",
  error: "red",
};

const LogViewer: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    let lastOffset = 0;
    let interval: ReturnType<typeof setInterval> | null = null;

    const logPath = getTodayLogPath();

    const poll = () => {
      try {
        const newLines = readLogLines(logPath.split(/[/\\]/).pop()!, lastOffset);
        if (newLines.length > 0) {
          const newEntries: LogEntry[] = [];
          for (const line of newLines) {
            try {
              newEntries.push(JSON.parse(line) as LogEntry);
            } catch {
              // 跳过无效行
            }
          }
          if (newEntries.length > 0) {
            lastOffset += newLines.length;
            setEntries((prev) => [...prev, ...newEntries]);
          }
        }
      } catch {
        // 文件可能还不存在
      }
    };

    // 读取已有内容
    poll();
    // 每 500ms 轮询
    interval = setInterval(poll, 500);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          📋 cyjcode-cli 日志查看器
        </Text>
        <Text color="gray" dimColor>
          {" "}
          — 实时监控日志流
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          {entries.length} 条日志 | 按 Ctrl+C 退出
        </Text>
      </Box>

      <Box marginY={1}>
        <Text color="gray" dimColor>
          {"—".repeat(
            Math.max(10, (process.stdout.columns || 80) - 2)
          )}
        </Text>
      </Box>

      {/* 日志列表 */}
      <Box flexDirection="column">
        {entries.length === 0 && (
          <Box>
            <Text color="gray" dimColor>
              等待日志……
            </Text>
          </Box>
        )}

        {entries.slice(-30).map((entry, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color="gray" dimColor>
                {formatTime(entry.timestamp)}{" "}
              </Text>
              <Text
                color={eventColors[entry.type] || "white"}
                bold
              >
                {entry.type}
              </Text>
            </Box>
            <Box paddingLeft={4}>
              <Text color={eventColors[entry.type] || "white"}>
                {formatData(entry)}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch {
    return timestamp;
  }
}

function formatData(entry: LogEntry): string {
  const { data } = entry;
  if (!data || Object.keys(data).length === 0) return "";

  switch (entry.type) {
    case "llm.request":
      return `model=${data.model || "?"} messages=${(data.messageCount as number) || 0}`;
    case "llm.response":
      return `tokens=${data.totalTokens || "?"}`;
    case "tool.start":
      return `${data.tool || "?"} args=${data.args ? JSON.stringify(data.args).substring(0, 80) : ""}`;
    case "tool.end":
      if (data.success) return "✓ 成功";
      return `✗ ${data.error || "失败"}`;
    case "error":
      return `${data.message || "未知错误"}`;
    default:
      return JSON.stringify(data).substring(0, 120);
  }
}

export default LogViewer;
