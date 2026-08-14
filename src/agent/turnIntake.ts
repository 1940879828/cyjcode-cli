import type { ChatMessage } from "../llm/types.js";

export type TurnIntent =
  | "discussion"
  | "implementation"
  | "debug"
  | "review"
  | "meta_control"
  | "question";

export interface TurnIntake {
  intents: TurnIntent[];
  allowedActions: string[];
  forbiddenActions: string[];
  activePrinciples: string[];
  executionChecklist: string[];
}

const INTENT_ORDER: TurnIntent[] = [
  "meta_control",
  "discussion",
  "question",
  "review",
  "debug",
  "implementation",
];

const META_CONTROL_PATTERN =
  /(?:先别改|不要改|不改|只讨论|只看方案|只分析|讨论性任务|撤回|暂停|别动|不要动|别改(?:代码|文件)?|(?:不|不要|不用|无需|不需要)\s*(?:做)?\s*(?:修改|改动|改代码|改文件))/i;
const REVIEW_PATTERN = /(?:\breview\b|审查|代码审查|看看有没有问题)/i;
const DEBUG_PATTERN = /(?:报错|白屏|失败|闪烁|状态错乱|偶现|加载慢|竞态|错乱)/i;
const IMPLEMENTATION_PATTERN =
  /(?:修改|修一下|修复|加一个|新增|删除|重构|帮我实现|请实现|改成|改为|把.+改(?:成|为|掉)?|实现(?:一下|一个|这个|功能))/i;
const STRONG_IMPLEMENTATION_PATTERN =
  /(?:修一下|修复|加一个|新增|删除|重构|帮我实现|请实现|帮我修改|请修改|直接修改|现在修改|马上修改|改一下|实现(?:一下|一个|这个|功能))/i;
const DISCUSSION_CONTEXT_PATTERN =
  /(?:讨论|讲讲|分析|方案|思路|要不要|是否|能不能|可不可以|怎么|如何|有没有办法|为什么|怎么样|比较好)/i;
const QUESTION_PATTERN = /(?:[?？]|有没有办法|为什么|怎么做|怎么办|如何|能不能|可不可以)/i;

export function analyzeTurnIntake(userMessage: string): TurnIntake | null {
  if (!userMessage.trim()) return null;
  const intents = detectIntents(stripQuotedCode(userMessage));
  return {
    intents,
    allowedActions: buildAllowedActions(intents),
    forbiddenActions: buildForbiddenActions(intents),
    activePrinciples: buildActivePrinciples(intents),
    executionChecklist: buildExecutionChecklist(intents),
  };
}

export function buildTurnIntakeMessage(intake: TurnIntake | null): ChatMessage | null {
  if (!intake) return null;
  return {
    role: "system",
    content: renderTurnIntake(intake),
  };
}

function detectIntents(text: string): TurnIntent[] {
  const intents = new Set<TurnIntent>();
  if (hasMetaControlIntent(text)) addMetaControlIntents(intents);
  if (REVIEW_PATTERN.test(text)) intents.add("review");
  if (DEBUG_PATTERN.test(text)) intents.add("debug");
  if (shouldAddImplementation(text, intents)) intents.add("implementation");
  if (QUESTION_PATTERN.test(text)) addQuestionIntents(intents);
  if (intents.size === 0) intents.add("discussion");
  return INTENT_ORDER.filter((intent) => intents.has(intent));
}

function hasMetaControlIntent(text: string): boolean {
  return META_CONTROL_PATTERN.test(stripDecisionQuestions(text));
}

function addMetaControlIntents(intents: Set<TurnIntent>): void {
  intents.add("meta_control");
  intents.add("discussion");
}

function addQuestionIntents(intents: Set<TurnIntent>): void {
  intents.add("question");
  if (!intents.has("implementation") && !intents.has("debug")) intents.add("discussion");
}

function shouldAddImplementation(text: string, intents: Set<TurnIntent>): boolean {
  if (intents.has("meta_control")) return false;
  if (intents.has("review") && !hasExplicitChangeRequest(text)) return false;
  if (!IMPLEMENTATION_PATTERN.test(text)) return false;
  return STRONG_IMPLEMENTATION_PATTERN.test(text) || !DISCUSSION_CONTEXT_PATTERN.test(text);
}

function hasExplicitChangeRequest(text: string): boolean {
  return STRONG_IMPLEMENTATION_PATTERN.test(text);
}

function stripQuotedCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\r\n]*`/g, "");
}

function stripDecisionQuestions(text: string): string {
  return text.replace(/(?:要不要|是否(?:需要)?)\s*(?:做)?\s*(?:修改|改动|改代码|改文件)/g, "");
}

function buildAllowedActions(intents: TurnIntent[]): string[] {
  if (intents.includes("meta_control")) return ["解释、分析、比较方案", "遵守用户本轮的暂停或不修改要求"];
  if (intents.includes("implementation") || intents.includes("debug")) {
    return ["读取相关文件", "定位根因", "做最小必要修改", "运行验证"];
  }
  if (intents.includes("review")) return ["阅读相关代码", "验证行为契约", "给出审查结论"];
  return ["解释、分析、比较方案", "回答用户问题"];
}

function buildForbiddenActions(intents: TurnIntent[]): string[] {
  if (intents.includes("meta_control")) return ["修改文件", "运行实现性改动", "忽略用户本轮的否定条件"];
  if (intents.includes("implementation") || intents.includes("debug")) {
    return ["用 delay/loading/吞错/无限重试/强刷掩盖问题", "只根据局部报错打补丁"];
  }
  return ["擅自修改文件", "擅自运行实现性改动"];
}

function buildActivePrinciples(intents: TurnIntent[]): string[] {
  const principles = ["第一性原理: 先还原真实目标、约束和因果链"];
  if (intents.includes("debug") || intents.includes("implementation")) {
    principles.push("禁止症状遮蔽: 修根因，不修表象");
  }
  principles.push("奥卡姆剃刀: 根因层面的最小必要方案");
  if (intents.includes("review")) principles.push("代码审查: 先验证行为契约，再下结论");
  return principles;
}

function buildExecutionChecklist(intents: TurnIntent[]): string[] {
  const checks = ["是否遗漏用户本轮的否定条件、路径、命令、数字或中间要求？"];
  if (intents.includes("implementation") || intents.includes("debug")) {
    checks.push("修改前是否已经读取相关文件和调用方？");
    checks.push("候选方案是在修根因，还是遮蔽症状？");
  }
  return checks;
}

function renderTurnIntake(intake: TurnIntake): string {
  return [
    "<turn_intake>",
    "内部本轮输入审读：用户原文是唯一事实来源，不要向用户复述本笔记。",
    `本轮意图: ${intake.intents.join(", ")}`,
    `允许动作: ${intake.allowedActions.join("、")}`,
    `禁止动作: ${intake.forbiddenActions.join("、")}`,
    "激活准则:",
    ...intake.activePrinciples.map((principle) => `- ${principle}`),
    `执行前检查: ${intake.executionChecklist.join("；")}`,
    "</turn_intake>",
  ].join("\n");
}
