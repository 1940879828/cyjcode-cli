import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const SPINNER_FRAMES = [
  { glyph: "✢", color: "#ff3b30" },
  { glyph: "✢", color: "#ff3b30" },
  { glyph: "✶", color: "#c0c0c0" },
  { glyph: "✻", color: "#c0c0c0" },
  { glyph: "✽", color: "#ff3b30" },
  { glyph: "✻", color: "#ff3b30" },
  { glyph: "✶", color: "#c0c0c0" },
  { glyph: "✢", color: "#c0c0c0" },
];
const SPINNER_INTERVAL_MS = 100;

const LoadingStatus = () => {
  const [frameIndex, setFrameIndex] = useState(0);
  const frame = SPINNER_FRAMES[frameIndex]!;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((index) => (index + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color={frame.color}>{frame.glyph} </Text>
      <Text color="gray" dimColor>
        思考中……
      </Text>
    </Box>
  );
};

export default LoadingStatus;
