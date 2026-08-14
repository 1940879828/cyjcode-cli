import assert from "node:assert/strict";
import test from "node:test";
import {
  USER_INPUT_FOCUS_MESSAGE_NAME,
  buildUserInputFocusMessage,
  isUserInputFocusMessage,
} from "../src/agent/userInputFocus.js";

test("builds an internal focus message from every meaningful user line", () => {
  const message = buildUserInputFocusMessage([
    "我发现 agent 注意力只在第一条和最后一条",
    "能不能在用户输入前先处理输入？",
    "- 每次用户输入都加一个流程",
    "2. 解决注意力丢失",
  ].join("\n"));

  assert.equal(message?.role, "system");
  assert.equal(message?.name, USER_INPUT_FOCUS_MESSAGE_NAME);
  assert.equal(isUserInputFocusMessage(message!), true);
  assert.match(message?.content ?? "", /1\. 我发现 agent 注意力只在第一条和最后一条/);
  assert.match(message?.content ?? "", /2\. 能不能在用户输入前先处理输入？/);
  assert.match(message?.content ?? "", /3\. 每次用户输入都加一个流程/);
  assert.match(message?.content ?? "", /4\. 解决注意力丢失/);
});

test("does not create focus messages for blank input", () => {
  assert.equal(buildUserInputFocusMessage(" \n\t"), null);
});
