import { z } from "zod";
import { defineTool } from "./defineTool.js";

const questionOptionSchema = z.object({
  label: z.string().min(1, "option label 不能为空")
    .describe("用户可选择的选项标签"),
  description: z.string().optional()
    .describe("选项说明，可用于解释选择后的影响"),
});

const questionSchema = z.object({
  question: z.string().min(1, "question 不能为空")
    .describe("要询问用户的问题"),
  options: z.array(questionOptionSchema).min(1, "options 至少需要一个选项")
    .describe("提供给用户选择的选项列表"),
  multiSelect: z.boolean().optional()
    .describe("是否允许多选，默认 false"),
});

const askUserQuestionArgsSchema = z.object({
  questions: z.array(questionSchema).min(1, "questions 至少需要一个问题")
    .describe("要询问用户的问题列表"),
});

export type AskUserQuestionOption = z.infer<typeof questionOptionSchema>;
export type AskUserQuestionItem = z.infer<typeof questionSchema>;

const askUserQuestion = defineTool({
  name: "AskUserQuestion",
  description:
    "在用户明确要求先询问或确认时，暂停当前任务并向用户提出一个或多个选择题。",
  schema: askUserQuestionArgsSchema,
  execute(args) {
    return {
      success: true,
      data: buildQuestionSummary(args.questions),
      metadata: {
        kind: "ask_user_question",
        questions: args.questions,
      },
      awaitUserResponse: true,
    };
  },
});

function buildQuestionSummary(questions: AskUserQuestionItem[]): string {
  const lines = ["等待用户回答。"];
  questions.forEach((item, index) => {
    lines.push("");
    lines.push(`${index + 1}. ${item.question}`);
    lines.push(`   模式: ${item.multiSelect ? "多选" : "单选"}`);
    item.options.forEach((option) => {
      lines.push(`   - ${option.label}`);
      if (option.description) lines.push(`     ${option.description}`);
    });
    lines.push("   - Other");
  });
  return lines.join("\n");
}

export default askUserQuestion;
