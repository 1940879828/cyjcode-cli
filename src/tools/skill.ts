import { z } from "zod";
import { defineTool } from "./defineTool.js";

const schema = z.object({
  name: z.string().min(1).describe("要加载的 skill 名称，例如 skill-creator 或 db-migration"),
  args: z.string().optional().describe("传给 skill 的可选参数"),
});

export default defineTool({
  name: "skill",
  description: "按名称加载一个已发现的 skill，将完整 SKILL.md 注入当前会话后继续执行任务。",
  schema,
  execute(args, context) {
    if (!context) return { success: false, error: "skill 工具缺少执行上下文" };
    const result = context.skillManager?.load(args.name, args.args, "tool");
    if (!result) return { success: false, error: "skill 工具缺少 SkillManager" };
    return {
      success: result.success,
      data: result.injection ? `Launching skill: ${result.skill?.name ?? args.name}` : result.message,
      error: result.success ? undefined : result.message,
      followUpMessages: result.injection ? [result.injection] : undefined,
    };
  },
});
