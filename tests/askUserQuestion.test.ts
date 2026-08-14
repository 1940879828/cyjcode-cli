import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import { selectExecutableToolCalls } from "../src/agent/loop.js";
import { executeToolCalls } from "../src/agent/toolExecution.js";
import type { AgentHistoryStore } from "../src/agent/runtime.js";
import type { AgentEvent } from "../src/agent/types.js";
import type { ChatMessage, ToolCall } from "../src/llm/types.js";
import askUserQuestion from "../src/tools/askUserQuestion.js";
import { toolsToOpenAI } from "../src/tools/index.js";

test("AskUserQuestion is part of the fixed built-in tool list", () => {
  assert.equal(hasTool(toolsToOpenAI(), "AskUserQuestion"), true);
});

test("system prompt constrains AskUserQuestion usage", () => {
  const prompt = buildSystemPrompt("D:/project/example", []);

  assert.match(prompt, /默认不要询问用户/);
  assert.match(prompt, /只有用户本轮明确要求/);
  assert.match(prompt, /调用它时必须作为本轮最后一个工具调用/);
});

test("AskUserQuestion returns waiting metadata", () => {
  const result = askUserQuestion.execute({
    questions: [{
      question: "选择哪种方案?",
      options: [{ label: "默认", description: "使用推荐设置" }],
      multiSelect: false,
    }],
  });

  assert.equal(result.success, true);
  assert.equal(result.awaitUserResponse, true);
  assert.equal(result.metadata?.kind, "ask_user_question");
  assert.deepEqual(result.metadata?.questions, [{
    question: "选择哪种方案?",
    options: [{ label: "默认", description: "使用推荐设置" }],
    multiSelect: false,
  }]);
});

test("AskUserQuestion rejects invalid question payloads", () => {
  const result = askUserQuestion.execute({ questions: [] });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /questions/);
});

test("AskUserQuestion tool execution emits await_user_input and stops batch", async () => {
  const history = createMemoryHistory();
  const events = await drainToolEvents(history, [
    askUserQuestionCall("call_ask"),
    readToolCall("call_read"),
  ]);

  assert.equal(events.some((event) => event.type === "await_user_input"), true);
  assert.equal(events.some((event) => event.type === "tool_result" && event.name === "read"), false);
  assert.equal(history.getMessages().length, 1);
  assert.equal(history.getMessages()[0]?.name, "AskUserQuestion");
});

test("tool execution emits tool_call before tool_result", async () => {
  const history = createMemoryHistory();
  const events = await drainToolEvents(history, [readToolCall("call_read")]);

  assert.deepEqual(events.slice(0, 2).map((event) => event.type), ["tool_call", "tool_result"]);
  assert.equal(history.getMessages().length, 1);
  assert.equal(history.getMessages()[0]?.name, "read");
});

test("tool calls after AskUserQuestion are excluded from the protocol batch", () => {
  const selected = selectExecutableToolCalls([
    readToolCall("call_read"),
    askUserQuestionCall("call_ask"),
    readToolCall("call_after"),
  ]);

  assert.deepEqual(selected.map((toolCall) => toolCall.id), ["call_read", "call_ask"]);
});

function hasTool(tools: Record<string, unknown>[], name: string): boolean {
  return tools.some((tool) => JSON.stringify(tool).includes(`"name":"${name}"`));
}

function createMemoryHistory(messages: ChatMessage[] = []): AgentHistoryStore {
  return {
    addMessage: (message) => messages.push(message),
    getMessages: () => [...messages],
    getLength: () => messages.length,
    truncate: (length) => {
      messages.length = Math.max(0, Math.min(length, messages.length));
    },
  };
}

async function drainToolEvents(history: AgentHistoryStore, toolCalls: ToolCall[]): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of executeToolCalls({
    sessionId: "test-session",
    turn: 1,
    toolCalls,
    history,
    workspaceRoot: process.cwd(),
  })) {
    events.push(event);
  }
  return events;
}

function askUserQuestionCall(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "AskUserQuestion",
      arguments: JSON.stringify({
        questions: [{ question: "选择哪种方案?", options: [{ label: "默认" }] }],
      }),
    },
  };
}

function readToolCall(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: { name: "read", arguments: JSON.stringify({ filePath: "package.json" }) },
  };
}
