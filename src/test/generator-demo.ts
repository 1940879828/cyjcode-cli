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
async function* agentStreamChat(): AsyncGenerator<
  | { type: "text_delta"; content: string }
  | { type: "tool_call_delta"; name?: string; args?: string }
  | { type: "done" }
> {
  for (const chunk of mockChunks) {
    await new Promise((r) => setTimeout(r, 1000)); // 模拟网络延迟

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield { type: "text_delta", content: delta.content };
    }
    if (delta.tool_calls) {
      const tc = delta.tool_calls[0]!;
      yield {
        type: "tool_call_delta",
        name: tc.function?.name || undefined,
        args: tc.function?.arguments || undefined,
      };
    }
  }
  yield { type: "done" };
}

// ==========================================
// 2. Agent 循环：这是 runAgentLoop() 的简化版
// ==========================================
async function* runAgentLoop(): AsyncGenerator<{
  type: "text_delta" | "tool_start" | "tool_result" | "done";
  content?: string;
}> {
  const maxRounds = 3;
  let round = 0;

  while (round < maxRounds) {
    round++;
    console.log(`  --- Agent 循环第 ${round} 轮 ---`);

    let hasToolCall = false;
    let toolName = "";
    let toolArgs = "";

    for await (const event of agentStreamChat()) {
      if (event.type === "text_delta") {
        yield { type: "text_delta", content: event.content };
      } else if (event.type === "tool_call_delta") {
        hasToolCall = true;
        // 流式拼接：第一片带 name，后续片只带 args 片段
        if (event.name) toolName = event.name;
        if (event.args) toolArgs += event.args;
      } else if (event.type === "done") {
        if (hasToolCall) {
          yield { type: "tool_start", content: `${toolName}(${toolArgs})` };
          const result = getWeather(JSON.parse(toolArgs).city);
          yield { type: "tool_result", content: result };
          // 真实项目中，工具结果会作为上下文传给下一轮 LLM 调用
        }
        yield { type: "done" };
        break;
      }
    }

    if (!hasToolCall) break;
    break; // 演示目的：跑一轮就停
  }
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
