import { z } from "zod";
import type { Tool, ToolExecuteContext, ToolResult } from "./types.js";

interface DefineToolInput<TSchema extends z.ZodType, TResult extends Promise<ToolResult> | ToolResult> {
  name: string;
  description: string;
  schema: TSchema;
  execute: (args: z.infer<TSchema>, context?: ToolExecuteContext) => TResult;
}

type DefinedTool<TResult extends Promise<ToolResult> | ToolResult> =
  Omit<Tool, "execute"> & {
    execute(args: Record<string, unknown>, context?: ToolExecuteContext): TResult extends Promise<ToolResult>
      ? Promise<ToolResult> | ToolResult
      : ToolResult;
  };

export function defineTool<TSchema extends z.ZodType, TResult extends Promise<ToolResult> | ToolResult>(
  input: DefineToolInput<TSchema, TResult>,
): DefinedTool<TResult> {
  return {
    name: input.name,
    description: input.description,
    parameters: toParameters(input.schema),
    execute(args: Record<string, unknown>, context?: ToolExecuteContext) {
      const parsed = input.schema.safeParse(args);
      if (!parsed.success) return { success: false, error: formatSchemaError(parsed.error) };
      return input.execute(parsed.data, context);
    },
  } as DefinedTool<TResult>;
}

function toParameters(schema: z.ZodType): Record<string, unknown> {
  const parameters = z.toJSONSchema(schema);
  return isRecord(parameters) ? parameters : { type: "object" };
}

function formatSchemaError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "工具参数无效";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
