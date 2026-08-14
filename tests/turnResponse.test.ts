import assert from "node:assert/strict";
import test from "node:test";
import { consumeStreamEvent, createTurnResponse } from "../src/agent/turnResponse.js";

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
