import assert from "node:assert/strict";
import test from "node:test";
import {
  formatContextUsage,
  formatContextUsageBar,
  formatTokenCount,
  getContextWindow,
  selectContextUsageView,
} from "../src/ui/contextUsage.js";

test("formatTokenCount uses binary K and M units", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(1023), "1023");
  assert.equal(formatTokenCount(1126), "1.1K");
  assert.equal(formatTokenCount(1024 * 1024), "1M");
});

test("formatContextUsage renders prompt tokens with a dense fallback bar", () => {
  assert.equal(formatContextUsage(0, 1000), "░░░░░░░░░░░░░░░ 0/1000 0.0%");
  assert.equal(formatContextUsage(200, 1000), "███░░░░░░░░░░░░ 200/1000 20.0%");
  assert.equal(formatContextUsage(750, 1000), "███████████░░░░ 750/1000 75.0%");
  assert.equal(formatContextUsage(1200, 1000), "███████████████ 1.2K/1000 100.0%");
});

test("formatContextUsageBar separates used and unused color-block segments", () => {
  assert.deepEqual(formatContextUsageBar(200, 1000), {
    used: "   ",
    unused: "            ",
    usedBackgroundColor: "#55A8E8",
    unusedBackgroundColor: "#2A2F36",
    suffix: "200/1000 20.0%",
  });
});

test("getContextWindow follows DeepSeek V4 and default model windows", () => {
  assert.equal(getContextWindow("deepseek-v4-pro"), 1024 * 1024);
  assert.equal(getContextWindow("deepseek-v4-flash"), 1024 * 1024);
  assert.equal(getContextWindow("other-model"), 256 * 1024);
});

test("selectContextUsageView uses promptTokens for context capacity", () => {
  assert.equal(selectContextUsageView({ status: "idle" }, "deepseek-v4-pro"), null);
  assert.deepEqual(
    selectContextUsageView({ status: "loading" }, "deepseek-v4-pro"),
    { text: "上下文 统计中...", color: "gray" },
  );
  assert.deepEqual(
    selectContextUsageView({
      status: "ready",
      usage: {
        promptTokens: 750,
        completionTokens: 100,
        totalTokens: 850,
      },
    }, "custom"),
    {
      text: "上下文",
      color: "gray",
      bar: {
        used: "",
        unused: "               ",
        usedBackgroundColor: "#55A8E8",
        unusedBackgroundColor: "#2A2F36",
        suffix: "750/256K 0.3%",
      },
    },
  );
});
