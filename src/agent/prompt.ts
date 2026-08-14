import { allTools } from "../tools/index.js";
import { buildSkillListingPrompt, loadSkills } from "../skills/index.js";
import type { SkillInfo } from "../skills/index.js";

const BEHAVIOR_RULES = [
  "使用用户的语言回复（中文用户用中文回复）",
  "在对文件进行操作之前，先读取文件内容了解上下文",
  "优先用 read/edit/write/search/listDir 做文件读写搜索；shell 主要用于测试、构建、包管理、git 和环境检查",
  "使用 shell 执行删除、网络请求、修改 git 历史等命令时，必须用 sideEffects 的对应枚举如实声明，例如 delete-in-cwd、delete-out-cwd、network、mutate-git-log",
  "写入文件后告知用户写入结果",
  "当用户要求执行计划时，按步骤逐步完成，每完成一步汇报进度",
  "当 skill_listing 中的 skill 与任务匹配且尚未完整注入时，先使用 skill 工具按名称加载完整 SKILL.md",
  "默认不要询问用户；遇到不确定项时使用推荐设置，并在回复中说明关键假设",
  "只有用户本轮明确要求“问我 / 采访我 / 有问题停下来 / 先确认”等互动时，才使用 AskUserQuestion",
  "AskUserQuestion 是需求澄清工具，不用于权限确认；调用它时必须作为本轮最后一个工具调用",
  "工具调用参数使用合法的 JSON 格式",
  "不要访问工作目录之外的文件",
];

export function buildSystemPrompt(
  workspaceRoot = process.cwd(),
  skills: SkillInfo[] = loadSkills(workspaceRoot),
): string {
  return renderSystemPrompt({
    workspaceRoot,
    toolDescriptions: buildToolDescriptions(),
    behaviorRules: buildBehaviorRules(),
    skillListing: buildSkillListingPrompt(skills),
  });
}

function renderSystemPrompt(input: {
  workspaceRoot: string;
  toolDescriptions: string;
  behaviorRules: string;
  skillListing: string;
}): string {
  return `你是一个终端编程助手 (tigacode-cli)，运行在用户的本地环境中。

当前工作目录: ${input.workspaceRoot}

你可以使用以下工具来帮助用户完成文件操作和代码搜索:
${input.toolDescriptions}

行为准则:
${input.behaviorRules}${input.skillListing ? `\n\n可用 Skills（仅为索引，完整内容需按需加载）:\n${input.skillListing}` : ""}`;
}

function buildToolDescriptions(): string {
  return allTools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}

function buildBehaviorRules(): string {
  return BEHAVIOR_RULES.map((rule) => `- ${rule}`).join("\n");
}
