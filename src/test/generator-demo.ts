/**
 * Agent 循环 —— runAgentLoop() 的简化版
 *
 * 运行: npx tsx src/test/generator-demo.ts
 *
 * 演示三层 AsyncGenerator 如何协作：
 *   1. agentStreamChat()   —— 对应 client.ts 的 streamChat()，封装 LLM 流
 *   2. runAgentLoop()      —— 对应 loop.ts，消费流并处理工具调用
 *   3. for await...of      —— CLI 层最终消费
 */

// ---- 模拟工具 ----
function getWeather(city: string): string {
  if (city === "北京") return "晴，25°C";
  if (city === "上海") return "多云，28°C";
  return "未知";
}

// ---- 模拟 LLM 返回的 chunk 流 ----
// 关键：tool_call 的 arguments 是分片返回的，需要拼接！
type MockDelta = {
  content?: string;
  tool_calls?: Array<{ index: number; function: { name?: string; arguments?: string } }>;
};

type AgentStreamEvent =
  | { type: "text_delta"; content: string }
  | { type: "tool_call_delta"; name?: string; args?: string }
  | { type: "done" };

type AgentLoopEvent = {
  type: "text_delta" | "tool_start" | "tool_result" | "done";
  content?: string;
};

type ToolCallDeltaEvent = Extract<AgentStreamEvent, { type: "tool_call_delta" }>;

interface ToolCallAccumulator {
  hasToolCall: boolean;
  toolName: string;
  toolArgs: string;
}

const mockChunks: Array<{ choices: Array<{ delta: MockDelta }> }> = [
  { choices: [{ delta: { content: "我来" } }] },
  { choices: [{ delta: { content: "帮你" } }] },
  { choices: [{ delta: { content: "查。" } }] },
  // 第一片：带 name + 第一段 arguments
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "getWeather", arguments: '{"city"' } }] } }] },
  // 后续片：只有 arguments 片段
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"北京"}' } }] } }] },
  { choices: [{ delta: {} }] },
];

// ---- 1. LLM 客户端：封装 API 流 ----
async function* agentStreamChat(): AsyncGenerator<AgentStreamEvent> {
  for (const chunk of mockChunks) {
    await delay(1000);
    const delta = chunk.choices[0]?.delta;
    if (delta) yield* createStreamEvents(delta);
  }
  yield { type: "done" };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStreamEvents(delta: MockDelta): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  if (delta.content) events.push({ type: "text_delta", content: delta.content });
  if (delta.tool_calls) events.push(createToolCallDeltaEvent(delta.tool_calls[0]!));
  return events;
}

function createToolCallDeltaEvent(
  toolCall: { function: { name?: string; arguments?: string } },
): ToolCallDeltaEvent {
  return {
    type: "tool_call_delta",
    name: toolCall.function?.name || undefined,
    args: toolCall.function?.arguments || undefined,
  };
}

// ==========================================
// 2. Agent 循环：这是 runAgentLoop() 的简化版
// ==========================================
async function* runAgentLoop(): AsyncGenerator<AgentLoopEvent> {
  const maxRounds = 3;
  for (let round = 1; round <= maxRounds; round++) {
    const hasToolCall = yield* runAgentRound(round);
    if (!hasToolCall) return;
    return; // 演示目的：跑一轮就停
  }
}

async function* runAgentRound(round: number): AsyncGenerator<AgentLoopEvent, boolean> {
  console.log(`  --- Agent 循环第 ${round} 轮 ---`);
  const toolCall = createToolCallAccumulator();

  for await (const event of agentStreamChat()) {
    if (event.type === "text_delta") {
      yield { type: "text_delta", content: event.content };
      continue;
    }
    if (event.type === "tool_call_delta") {
      appendToolCallDelta(toolCall, event);
      continue;
    }
    yield* finishAgentRound(toolCall);
    return toolCall.hasToolCall;
  }

  return toolCall.hasToolCall;
}

function createToolCallAccumulator(): ToolCallAccumulator {
  return { hasToolCall: false, toolName: "", toolArgs: "" };
}

function appendToolCallDelta(
  toolCall: ToolCallAccumulator,
  event: ToolCallDeltaEvent,
): void {
  toolCall.hasToolCall = true;
  if (event.name) toolCall.toolName = event.name;
  if (event.args) toolCall.toolArgs += event.args;
}

function* finishAgentRound(toolCall: ToolCallAccumulator): Generator<AgentLoopEvent> {
  if (toolCall.hasToolCall) {
    yield { type: "tool_start", content: `${toolCall.toolName}(${toolCall.toolArgs})` };
    yield { type: "tool_result", content: getWeather(JSON.parse(toolCall.toolArgs).city) };
  }
  yield { type: "done" };
}

// ==========================================
// 3. CLI 层：最终消费 Agent 事件
// ==========================================
console.log("Agent 开始响应:\n");

for await (const event of runAgentLoop()) {
  switch (event.type) {
    case "text_delta":
      console.log(`  💬 文本: "${event.content}"`);
      break;
    case "tool_start":
      console.log(`  🔧 调用工具: ${event.content}`);
      break;
    case "tool_result":
      console.log(`  📊 工具结果: ${event.content}`);
      break;
    case "done":
      console.log(`  ✅ 完成`);
      break;
  }
}

console.log("\n===== 全部示例结束 =====");
