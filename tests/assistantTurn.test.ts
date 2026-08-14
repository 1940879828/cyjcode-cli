import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAssistantPart,
  appendAssistantTextDelta,
  createAssistantTurn,
  finalizeAssistantTurn,
  replaceAssistantPart,
} from "../src/ui/assistantTurn.js";

test("keeps text delta streaming before finalizing assistant turn", () => {
  const streamingTurn = appendAssistantTextDelta(
    createAssistantTurn("turn_1", 1),
    "正在分析",
  );

  assert.equal(streamingTurn.activeText, "正在分析");
  assert.deepEqual(streamingTurn.parts, []);

  const finalTurn = finalizeAssistantTurn(streamingTurn, "text_1", "（无回复内容）");

  assert.equal(finalTurn.activeText, "");
  assert.deepEqual(finalTurn.parts, [
    { id: "text_1", kind: "text", content: "正在分析" },
  ]);
});

test("collects text, tool summary and following text in order", () => {
  const turnWithIntro = appendAssistantTextDelta(
    createAssistantTurn("turn_1", 1),
    "让我看看当前入口文件和开发脚本",
  );
  const turnWithTool = appendAssistantPart(turnWithIntro, "text_1", {
    id: "tool_1",
    kind: "tool",
    content: '👀读取文件"src/cli.tsx"',
  });
  const turnWithConclusion = appendAssistantTextDelta(
    turnWithTool,
    "问题很明确，入口文件已经显示。",
  );

  const finalTurn = finalizeAssistantTurn(turnWithConclusion, "text_2", "（无回复内容）");

  assert.deepEqual(finalTurn.parts, [
    { id: "text_1", kind: "text", content: "让我看看当前入口文件和开发脚本" },
    { id: "tool_1", kind: "tool", content: '👀读取文件"src/cli.tsx"' },
    { id: "text_2", kind: "text", content: "问题很明确，入口文件已经显示。" },
  ]);
});

test("keeps multiple tool summaries in arrival order", () => {
  const firstToolTurn = appendAssistantPart(
    createAssistantTurn("turn_1", 1),
    "unused_text_1",
    { id: "tool_1", kind: "tool", content: '👀读取文件"package.json"' },
  );
  const secondToolTurn = appendAssistantPart(firstToolTurn, "unused_text_2", {
    id: "tool_2",
    kind: "tool",
    content: '👀读取文件"src/cli.tsx"',
  });

  assert.deepEqual(secondToolTurn.parts, [
    { id: "tool_1", kind: "tool", content: '👀读取文件"package.json"' },
    { id: "tool_2", kind: "tool", content: '👀读取文件"src/cli.tsx"' },
  ]);
});

test("stores failed tool summary as an assistant turn error part", () => {
  const failedToolTurn = appendAssistantPart(
    createAssistantTurn("turn_1", 1),
    "unused_text_1",
    {
      id: "error_1",
      kind: "error",
      content: '👀读取文件"missing.ts" 失败: 文件不存在',
    },
  );

  assert.deepEqual(failedToolTurn.parts, [
    {
      id: "error_1",
      kind: "error",
      content: '👀读取文件"missing.ts" 失败: 文件不存在',
    },
  ]);
});

test("replaces assistant part by id", () => {
  const turn = appendAssistantPart(
    createAssistantTurn("turn_1", 1),
    "unused_text_1",
    { id: "tool_1", kind: "tool", content: '⚙️运行命令"npm test" …' },
  );

  const replaced = replaceAssistantPart(turn, "tool_1", {
    id: "tool_1",
    kind: "tool",
    content: '⚙️运行命令"npm test"',
  });

  assert.deepEqual(replaced.parts, [
    { id: "tool_1", kind: "tool", content: '⚙️运行命令"npm test"' },
  ]);
});

test("keeps assistant turn unchanged when replacing missing part", () => {
  const turn = appendAssistantPart(
    createAssistantTurn("turn_1", 1),
    "unused_text_1",
    { id: "tool_1", kind: "tool", content: '👀读取文件"package.json"' },
  );

  const replaced = replaceAssistantPart(turn, "missing", {
    id: "missing",
    kind: "tool",
    content: "ignored",
  });

  assert.equal(replaced, turn);
});
