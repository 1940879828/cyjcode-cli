import assert from "node:assert/strict";
import test from "node:test";
import { consumeStreamEvent, createTurnResponse } from "../src/agent/turnResponse.js";

test("accumulates text deltas in turn response", () => {
  const response = createTurnResponse();

  consumeStreamEvent({
    type: "text_delta",
    content: "你好",
  }, { sessionId: "test-session", turn: 1, response });
  consumeStreamEvent({
    type: "text_delta",
    content: "，世界",
  }, { sessionId: "test-session", turn: 1, response });

  assert.equal(response.fullText, "你好，世界");
});

test("forwards tool call deltas as agent events", () => {
  const response = createTurnResponse();
  const event = consumeStreamEvent({
    type: "tool_call_delta",
    deltas: [{
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "read", arguments: "{\"filePath\"" },
    }],
  }, { sessionId: "test-session", turn: 1, response });

  assert.deepEqual(event, {
    type: "tool_call_delta",
    deltas: [{
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "read", arguments: "{\"filePath\"" },
    }],
  });
});

test("done stores tool calls without changing accumulated text", () => {
  const response = createTurnResponse();
  const toolCalls = [{
    id: "call_1",
    type: "function" as const,
    function: { name: "read", arguments: "{\"filePath\":\"src/cli.tsx\"}" },
  }];

  consumeStreamEvent({
    type: "text_delta",
    content: "先看入口。",
  }, { sessionId: "test-session", turn: 1, response });
  consumeStreamEvent({
    type: "done",
    toolCalls,
  }, { sessionId: "test-session", turn: 1, response });

  assert.equal(response.fullText, "先看入口。");
  assert.equal(response.toolCalls, toolCalls);
});
