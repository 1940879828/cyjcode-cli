import type { TokenUsage } from "../llm/types.js";

const CONTEXT_BAR_WIDTH = 15;
const CONTEXT_BAR_CELL = " ";
const CONTEXT_BAR_USED_FALLBACK_CELL = "█";
const CONTEXT_BAR_UNUSED_FALLBACK_CELL = "░";
const DEFAULT_CONTEXT_WINDOW = 256 * 1024;
const DEEPSEEK_V4_CONTEXT_WINDOW = 1024 * 1024;
const DEEPSEEK_V4_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const CURSOR_BLUE = "#55A8E8";
const BAR_UNUSED_BACKGROUND = "#2A2F36";

export type ContextUsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; usage: TokenUsage }
  | { status: "error" };

export type ContextUsageView = {
  text: string;
  color: "gray" | "yellow" | "red";
  bar?: ContextUsageBarView;
};

export interface ContextUsageBarView {
  used: string;
  unused: string;
  usedBackgroundColor: string;
  unusedBackgroundColor: string;
  suffix: string;
  cacheHitLabel?: string;
}

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
  const bar = formatContextUsageBar(promptTokens, contextWindow);
  return `${toFallbackBar(bar)} ${bar.suffix}`;
}

export function formatContextUsageBar(
  promptTokens: number,
  contextWindow: number,
): ContextUsageBarView {
  const safePromptTokens = normalizeTokenCount(promptTokens);
  const ratio = getUsageRatio(safePromptTokens, contextWindow);
  const cappedRatio = Math.min(1, ratio);
  const filledBlocks = Math.round(cappedRatio * CONTEXT_BAR_WIDTH);
  const percent = Math.min(100, ratio * 100).toFixed(1);

  return {
    used: CONTEXT_BAR_CELL.repeat(filledBlocks),
    unused: CONTEXT_BAR_CELL.repeat(CONTEXT_BAR_WIDTH - filledBlocks),
    usedBackgroundColor: CURSOR_BLUE,
    unusedBackgroundColor: BAR_UNUSED_BACKGROUND,
    suffix: `${formatTokenCount(safePromptTokens)}/${formatTokenCount(contextWindow)} ${percent}%`,
  };
}

function normalizeTokenCount(tokens: number): number {
  return Number.isFinite(tokens) ? Math.max(0, tokens) : 0;
}

function getUsageRatio(promptTokens: number, contextWindow: number): number {
  return Number.isFinite(contextWindow) && contextWindow > 0
    ? promptTokens / contextWindow
    : 0;
}

function toFallbackBar(bar: ContextUsageBarView): string {
  return `${CONTEXT_BAR_USED_FALLBACK_CELL.repeat(bar.used.length)}${CONTEXT_BAR_UNUSED_FALLBACK_CELL.repeat(bar.unused.length)}`;
}

export function selectContextUsageView(
  state: ContextUsageState,
  model: string,
): ContextUsageView {
  if (state.status === "idle") {
    return selectIdleContextUsageView(model);
  }
  if (state.status === "loading") {
    return { text: "统计中...", color: "gray" };
  }
  if (state.status === "error") {
    return { text: "统计失败", color: "red" };
  }

  return selectReadyContextUsageView(state.usage, model);
}

function selectIdleContextUsageView(model: string): ContextUsageView {
  return {
    text: "",
    color: "gray",
    bar: formatContextUsageBar(0, getContextWindow(model)),
  };
}

function selectReadyContextUsageView(usage: TokenUsage, model: string): ContextUsageView {
  const contextWindow = getContextWindow(model);
  const ratio = usage.promptTokens / contextWindow;
  const cacheHitLabel = formatCacheHitLabel(usage);
  const bar = {
    ...formatContextUsageBar(usage.promptTokens, contextWindow),
    ...(cacheHitLabel === undefined ? {} : { cacheHitLabel }),
  };
  return {
    text: "",
    color: getUsageColor(ratio),
    bar,
  };
}

export function formatCacheHitLabel(usage: TokenUsage): string | undefined {
  const cacheHitTokens = normalizeOptionalTokenCount(usage.cacheHitTokens);
  const cacheMissTokens = normalizeOptionalTokenCount(usage.cacheMissTokens);
  if (cacheHitTokens === undefined || cacheMissTokens === undefined) return undefined;

  const cacheInputTokens = cacheHitTokens + cacheMissTokens;
  return cacheInputTokens > 0
    ? `缓存:${(cacheHitTokens / cacheInputTokens * 100).toFixed(1)}%`
    : undefined;
}

function normalizeOptionalTokenCount(tokens: number | undefined): number | undefined {
  return tokens === undefined ? undefined : normalizeTokenCount(tokens);
}

function getUsageColor(ratio: number): ContextUsageView["color"] {
  if (ratio >= 0.9) return "red";
  if (ratio >= 0.7) return "yellow";
  return "gray";
}
