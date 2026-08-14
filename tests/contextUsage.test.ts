import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCacheHitLabel,
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

test("formatCacheHitLabel shows provider cache token hit rate", () => {
  assert.equal(formatCacheHitLabel({
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cacheHitTokens: 900,
    cacheMissTokens: 100,
  }), "缓存:90.0%");
  assert.equal(formatCacheHitLabel({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
  }), undefined);
  assert.equal(formatCacheHitLabel({
    promptTokens: 1000,
    completionTokens: 100,
    totalTokens: 1100,
    cacheHitTokens: 900,
  }), undefined);
});

test("getContextWindow follows DeepSeek V4 and default model windows", () => {
  assert.equal(getContextWindow("deepseek-v4-pro"), 1024 * 1024);
  assert.equal(getContextWindow("deepseek-v4-flash"), 1024 * 1024);
  assert.equal(getContextWindow("other-model"), 256 * 1024);
});

test("selectContextUsageView shows context capacity for every state", () => {
  assert.deepEqual(
    selectContextUsageView({ status: "idle" }, "deepseek-v4-pro"),
    {
      text: "",
      color: "gray",
      bar: {
        used: "",
        unused: "               ",
        usedBackgroundColor: "#55A8E8",
        unusedBackgroundColor: "#2A2F36",
        suffix: "0/1M 0.0%",
      },
    },
  );
  assert.deepEqual(
    selectContextUsageView({ status: "loading" }, "deepseek-v4-pro"),
    { text: "统计中...", color: "gray" },
  );
  assert.deepEqual(
    selectContextUsageView({ status: "error" }, "deepseek-v4-pro"),
    { text: "统计失败", color: "red" },
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
      text: "",
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
  assert.deepEqual(
    selectContextUsageView({
      status: "ready",
      usage: {
        promptTokens: 1000,
        completionTokens: 100,
        totalTokens: 1100,
        cacheHitTokens: 900,
        cacheMissTokens: 100,
      },
    }, "custom"),
    {
      text: "",
      color: "gray",
      bar: {
        used: "",
        unused: "               ",
        usedBackgroundColor: "#55A8E8",
        unusedBackgroundColor: "#2A2F36",
        suffix: "1000/256K 0.4%",
        cacheHitLabel: "缓存:90.0%",
      },
    },
  );
});
