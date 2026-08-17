import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const LOADING_COLOR = "#55A8E8";
const LOADING_GLYPHS = ["✦", "✧", "✶", "✷", "✹", "✷", "✶", "✧"] as const;
const GLYPH_INTERVAL_MS = 160;
const ELAPSED_INTERVAL_MS = 1000;

interface Props {
  message?: string;
  showElapsed?: boolean;
}

const LoadingStatus = ({ message = "思考中...", showElapsed = false }: Props) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((index) => (index + 1) % LOADING_GLYPHS.length);
    }, GLYPH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showElapsed) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / ELAPSED_INTERVAL_MS));
    }, ELAPSED_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [showElapsed]);

  return (
    <Box>
      <Text color={getLoadingColor()}>
        {getLoadingGlyph(frameIndex)} {message}
        {showElapsed ? ` (${formatElapsedSeconds(elapsedSeconds)} · Esc 中断)` : ""}
      </Text>
    </Box>
  );
};

export function getLoadingColor(): string {
  return LOADING_COLOR;
}

export function getLoadingGlyph(frameIndex: number): string {
  const flooredIndex = Math.floor(frameIndex);
  const glyphIndex = ((flooredIndex % LOADING_GLYPHS.length) + LOADING_GLYPHS.length) % LOADING_GLYPHS.length;
  return LOADING_GLYPHS[glyphIndex]!;
}

export function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}小时${minutes % 60}分钟${seconds % 60}秒`;
  if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`;
  return `${seconds}秒`;
}

export default LoadingStatus;
