import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTurnIntake, buildTurnIntakeMessage } from "../src/agent/turnIntake.js";

test("meta control discussion forbids code changes", () => {
  const intake = analyzeTurnIntake("撤回，先别改，这是讨论性任务，不改");

  assert.deepEqual(intake?.intents, ["meta_control", "discussion"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("修改文件")), true);
  assert.equal(intake?.allowedActions.some((action) => action.includes("解释")), true);
});

test("debug implementation activates root-cause principles", () => {
  const intake = analyzeTurnIntake("修一下白屏问题");

  assert.deepEqual(intake?.intents, ["debug", "implementation"]);
  assert.equal(intake?.activePrinciples.some((principle) => principle.includes("第一性原理")), true);
  assert.equal(intake?.activePrinciples.some((principle) => principle.includes("禁止症状遮蔽")), true);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("delay")), true);
});

test("review phrasing does not become implementation just because it mentions implementation", () => {
  const intake = analyzeTurnIntake("review 这段实现");

  assert.deepEqual(intake?.intents, ["review"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("擅自修改文件")), true);
});

test("explicit no-edit phrasing wins over implementation words", () => {
  const intake = analyzeTurnIntake("不要修改代码，只看方案");

  assert.deepEqual(intake?.intents, ["meta_control", "discussion"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("修改文件")), true);
});

test("implementation discussion does not imply code changes", () => {
  const intake = analyzeTurnIntake("讲讲这个实现方案怎么样？");

  assert.deepEqual(intake?.intents, ["discussion", "question"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("擅自修改文件")), true);
});

test("modification questions stay discussion oriented", () => {
  const intake = analyzeTurnIntake("怎么修改这个设计比较好？");

  assert.deepEqual(intake?.intents, ["discussion", "question"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("擅自修改文件")), true);
});

test("modification planning without direct command stays discussion", () => {
  const intake = analyzeTurnIntake("讨论一下要不要修改这块");
  const second = analyzeTurnIntake("讨论把 A 改成 B 是否合理？");

  assert.deepEqual(intake?.intents, ["discussion"]);
  assert.deepEqual(second?.intents, ["discussion", "question"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("擅自修改文件")), true);
});

test("direct rewrite command enters implementation mode", () => {
  const intake = analyzeTurnIntake("把 A 改成 B");

  assert.deepEqual(intake?.intents, ["implementation"]);
  assert.equal(intake?.allowedActions.some((action) => action.includes("做最小必要修改")), true);
});

test("no-modification variants override modification keywords", () => {
  const intake = analyzeTurnIntake("不要做修改，先讨论方案");
  const second = analyzeTurnIntake("无需修改，只分析问题");

  assert.deepEqual(intake?.intents, ["meta_control", "discussion"]);
  assert.deepEqual(second?.intents, ["meta_control", "discussion"]);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("修改文件")), true);
});

test("quoted control words do not override the surrounding request", () => {
  const intake = analyzeTurnIntake("帮我实现检测 `先别改` 字符串的功能");

  assert.deepEqual(intake?.intents, ["implementation"]);
  assert.equal(intake?.allowedActions.some((action) => action.includes("做最小必要修改")), true);
});

test("plain questions stay discussion oriented and forbid unsolicited edits", () => {
  const intake = analyzeTurnIntake("有没有办法解决这个注意力问题？");

  assert.deepEqual(intake?.intents, ["discussion", "question"]);
  assert.equal(intake?.allowedActions.some((action) => action.includes("回答用户问题")), true);
  assert.equal(intake?.forbiddenActions.some((action) => action.includes("擅自修改文件")), true);
});

test("blank input does not create turn intake message", () => {
  assert.equal(analyzeTurnIntake(" \n\t"), null);
  assert.equal(buildTurnIntakeMessage(null), null);
});

test("renders a short internal turn intake prompt", () => {
  const message = buildTurnIntakeMessage(analyzeTurnIntake("修复偶现失败"));

  assert.equal(message?.role, "system");
  assert.match(message?.content ?? "", /<turn_intake>/);
  assert.match(message?.content ?? "", /本轮意图: debug, implementation/);
  assert.match(message?.content ?? "", /用户原文是唯一事实来源/);
  assert.match(message?.content ?? "", /<\/turn_intake>/);
});
