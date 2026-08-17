import assert from "node:assert/strict";
import test from "node:test";
import {
  formatElapsedSeconds,
  getLoadingColor,
  getLoadingGlyph,
} from "../src/ui/components/LoadingStatus/LoadingStatus.js";

test("formatElapsedSeconds renders seconds only", () => {
  assert.equal(formatElapsedSeconds(0), "0秒");
  assert.equal(formatElapsedSeconds(59), "59秒");
});

test("formatElapsedSeconds renders minutes and seconds", () => {
  assert.equal(formatElapsedSeconds(60), "1分钟0秒");
  assert.equal(formatElapsedSeconds(125), "2分钟5秒");
});

test("formatElapsedSeconds renders hours minutes and seconds", () => {
  assert.equal(formatElapsedSeconds(3600), "1小时0分钟0秒");
  assert.equal(formatElapsedSeconds(3725), "1小时2分钟5秒");
});

test("getLoadingColor matches the cursor blue", () => {
  assert.equal(getLoadingColor(), "#55A8E8");
});

test("getLoadingGlyph starts with the star glyph", () => {
  assert.equal(getLoadingGlyph(0), "✦");
});

test("getLoadingGlyph morphs and cycles", () => {
  assert.equal(getLoadingGlyph(1), "✧");
  assert.equal(getLoadingGlyph(8), "✦");
});

test("getLoadingGlyph handles negative frames", () => {
  assert.equal(getLoadingGlyph(-1), "✧");
});
