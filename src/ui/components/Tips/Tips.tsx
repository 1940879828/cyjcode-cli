import { useEffect, useState } from "react";
import { Box, Text } from "ink";

const TIP_ROTATION_INTERVAL_MS = 10000;

interface Props {
  messages: readonly string[];
}

const Tips = ({ messages }: Props) => {
  const [messageIndex, setMessageIndex] = useState(0);
  const messagesKey = messages.join("\n");
  const message = messages[messageIndex % messages.length] ?? "";

  useEffect(() => {
    setMessageIndex(0);
  }, [messagesKey]);

  useEffect(() => {
    if (messages.length <= 1) return;
    const timer = setInterval(() => {
      setMessageIndex((index) => (index + 1) % messages.length);
    }, TIP_ROTATION_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [messages.length, messagesKey]);

  return (
    <Box height={1} overflow="hidden">
      <Text color="#55A8E8">i </Text>
      <Text color="gray" dimColor wrap="truncate-end">
        {message}
      </Text>
    </Box>
  );
};

export default Tips;
