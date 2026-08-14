import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent } from "../src/agent/types.js";
import {
  consumeChatEvent,
  createChatEventSession,
  type PendingAskUserQuestion,
  type ChatEventHandlers,
} from "../src/ui/chatEventReducer.js";
import type { ContextUsageState } from "../src/ui/contextUsage.js";
import type { AssistantTurn } from "../src/ui/assistantTurn.js";
import type { ChatEntry, TextChatEntry } from "../src/ui/chatTypes.js";

function createHarness() {
  const entries: ChatEntry[] = [];
  let nextId = 0;
  let streamingReasoning = "";
  let streamingAssistantTurn: AssistantTurn | null = null;
  let contextUsage: ContextUsageState = { status: "loading" };
  let pendingQuestion: PendingAskUserQuestion | null = null;
  const handlers: ChatEventHandlers = {
    append: (entry) => entries.push(entry),
    makeEntry: (role, content, extra) => ({
      id: `entry_${++nextId}`,
      role,
      content,
      timestamp: nextId,
      ...extra,
    }),
    nextId: () => `entry_${++nextId}`,
    setStreamingReasoning: (value) => {
      streamingReasoning = value;
    },
    setStreamingAssistantTurn: (value) => {
      streamingAssistantTurn = value;
    },
    setContextUsage: (value) => {
      contextUsage = typeof value === "function" ? value(contextUsage) : value;
    },
    setPendingQuestion: (value) => {
      pendingQuestion = value;
    },
  };

  return {
    entries,
    handlers,
    get streamingReasoning() { return streamingReasoning; },
    get streamingAssistantTurn() { return streamingAssistantTurn; },
    get contextUsage() { return contextUsage; },
    get pendingQuestion() { return pendingQuestion; },
  };
}

test("collects reasoning and final assistant text", () => {
  const harness = createHarness();
  const session = createChatEventSession();

  consumeChatEvent({ type: "reasoning_delta", content: "分析中" }, session, harness.handlers);
  consumeChatEvent({ type: "text_delta", content: "完成" }, session, harness.handlers);
  consumeChatEvent({ type: "done", fullText: "完成" }, session, harness.handlers);

  assert.equal(harness.streamingReasoning, "");
  assert.equal(harness.streamingAssistantTurn, null);
  assert.equal((harness.entries[0] as TextChatEntry).role, "thinking");
  assert.equal((harness.entries[0] as TextChatEntry).content, "分析中");
  assert.deepEqual((harness.entries[1] as AssistantTurn).parts.at(-1), {
    id: "entry_3",
    kind: "text",
    content: "完成",
  });
});

test("keeps ready usage after done", () => {
  const harness = createHarness();
  const session = createChatEventSession();
  const usageEvent: AgentEvent = {
    type: "usage",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  };

  consumeChatEvent(usageEvent, session, harness.handlers);
  consumeChatEvent({ type: "done", fullText: "" }, session, harness.handlers);

  assert.deepEqual(harness.contextUsage, {
    status: "ready",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  });
});

test("turns standalone errors into chat entries", () => {
  const harness = createHarness();
  const session = createChatEventSession();

  consumeChatEvent({ type: "error", error: "boom" }, session, harness.handlers);

  assert.deepEqual(harness.entries, [{
    id: "entry_1",
    role: "error",
    content: "错误: boom",
    timestamp: 1,
  }]);
  assert.deepEqual(harness.contextUsage, { status: "error" });
});

test("await user input finalizes streaming turn and stores pending question", () => {
  const harness = createHarness();
  const session = createChatEventSession();

  consumeChatEvent({ type: "tool_call", callId: "call_1", name: "AskUserQuestion", arguments: {} }, session, harness.handlers);
  consumeChatEvent({
    type: "tool_result",
    callId: "call_1",
    name: "AskUserQuestion",
    result: { success: true, data: "等待用户回答。" },
  }, session, harness.handlers);
  consumeChatEvent({
    type: "await_user_input",
    callId: "call_1",
    questions: [{ question: "选哪个?", options: [{ label: "A" }] }],
  }, session, harness.handlers);

  assert.equal(harness.entries.length, 1);
  assert.equal(harness.streamingAssistantTurn, null);
  assert.deepEqual(harness.contextUsage, { status: "idle" });
  assert.deepEqual(harness.pendingQuestion, {
    callId: "call_1",
    questions: [{ question: "选哪个?", options: [{ label: "A" }] }],
  });
});
