import type { TokenUsage } from "../llm/types.js";

const CONTEXT_BAR_WIDTH = 10;
const DEFAULT_CONTEXT_WINDOW = 256 * 1024;
const DEEPSEEK_V4_CONTEXT_WINDOW = 1024 * 1024;
const DEEPSEEK_V4_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

export type ContextUsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; usage: TokenUsage }
  | { status: "error" };

export type ContextUsageView = {
  text: string;
  color: "gray" | "yellow" | "red";
};

export function getContextWindow(model: string): number {
  return DEEPSEEK_V4_MODELS.has(model.trim())
    ? DEEPSEEK_V4_CONTEXT_WINDOW
    : DEFAULT_CONTEXT_WINDOW;
}

export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens < 1024) {
    return String(Math.round(tokens));
  }

  const unit = tokens >= 1024 * 1024 ? "M" : "K";
  const divisor = unit === "M" ? 1024 * 1024 : 1024;
  return `${Number((tokens / divisor).toFixed(1))}${unit}`;
}

export function formatContextUsage(
  promptTokens: number,
  contextWindow: number,
): string {
  const safePromptTokens = Number.isFinite(promptTokens)
    ? Math.max(0, promptTokens)
    : 0;
  const ratio = Number.isFinite(contextWindow) && contextWindow > 0
    ? safePromptTokens / contextWindow
    : 0;
  const cappedRatio = Math.min(1, ratio);
  const filledBlocks = Math.round(cappedRatio * CONTEXT_BAR_WIDTH);
  const bar = `${"|".repeat(filledBlocks)}${".".repeat(CONTEXT_BAR_WIDTH - filledBlocks)}`;
  const percent = Math.min(100, ratio * 100).toFixed(1);

  return `${bar} ${formatTokenCount(safePromptTokens)}/${formatTokenCount(contextWindow)} ${percent}%`;
}

export function selectContextUsageView(
  state: ContextUsageState,
  model: string,
): ContextUsageView | null {
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "loading") {
    return { text: "上下文 统计中...", color: "gray" };
  }
  if (state.status === "error") {
    return { text: "上下文 统计失败", color: "red" };
  }

  const contextWindow = getContextWindow(model);
  const ratio = state.usage.promptTokens / contextWindow;
  return {
    text: `上下文 ${formatContextUsage(state.usage.promptTokens, contextWindow)}`,
    color: getUsageColor(ratio),
  };
}

function getUsageColor(ratio: number): ContextUsageView["color"] {
  if (ratio >= 0.9) return "red";
  if (ratio >= 0.7) return "yellow";
  return "gray";
}
