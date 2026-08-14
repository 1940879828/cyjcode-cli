import { Box, Text } from "ink";
import type { AppConfig } from "../config/store.js";
import { selectContextUsageView } from "./contextUsage.js";
import type { ContextUsageView } from "./contextUsage.js";

export function ContextUsageFooter({
  config,
  contextUsage,
}: {
  config: AppConfig;
  contextUsage: Parameters<typeof selectContextUsageView>[0];
}) {
  const contextUsageView = selectContextUsageView(contextUsage, config.model);
  return (
    <Box paddingX={1} height={1}>
      <Text>{config.model}</Text>
      {config.thinking ? (
        <>
          <FooterSeparator />
          <Text>Thinking ON</Text>
          <FooterSeparator />
          <Text>{`Effort:${config.reasoningEffort}`}</Text>
        </>
      ) : null}
      <FooterSeparator />
      <ContextUsageIndicator view={contextUsageView} />
    </Box>
  );
}

function FooterSeparator() {
  return (
    <Text color="gray" >
      {" | "}
    </Text>
  );
}

function ContextUsageIndicator({ view }: { view: ContextUsageView }) {
  if (view.bar) {
    return <ContextUsageBar view={view} />;
  }
  return (
    <Text color={view.color} dimColor={view.color === "gray"}>
      {view.text}
    </Text>
  );
}

function ContextUsageBar({ view }: { view: ContextUsageView }) {
  if (!view.bar) return null;
  return (
    <>
      <Text backgroundColor={view.bar.usedBackgroundColor}>{view.bar.used}</Text>
      <Text backgroundColor={view.bar.unusedBackgroundColor}>{view.bar.unused}</Text>
      <Text color="gray" dimColor>{` ${view.bar.suffix}`}</Text>
      {view.bar.cacheHitLabel ? (
        <Text color="gray" dimColor>{` ${view.bar.cacheHitLabel}`}</Text>
      ) : null}
    </>
  );
}
