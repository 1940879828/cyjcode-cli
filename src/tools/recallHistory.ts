import { z } from "zod";
import { defineTool } from "./defineTool.js";
import type { ToolResult } from "./types.js";
import type {
  ObservationMask,
  ObservationStore,
  RecalledObservation,
} from "../agent/observationStore.js";

interface RecallHistoryLookup {
  maskId?: string;
  query?: string;
}

const recallHistoryArgsSchema = z.object({
  maskId: z.string().optional().describe("要恢复的历史遮罩 id，例如 mask_ab12cd34ef"),
  query: z.string().optional().describe("按关键词搜索历史遮罩，未提供 maskId 时使用"),
  limit: z.number().int().positive().max(10).optional().describe("query 模式最多返回多少个结果"),
}).refine((args) => hasLookupKey(args), {
  message: "maskId 或 query 至少提供一个",
});

const recallHistory = defineTool({
  name: "recall_history",
  description:
    "从观测遮罩的历史副本中恢复旧工具结果。优先用 maskId 精确恢复；返回 freshness=fresh 时可当当前事实，stale/unknown 时需重新 read/search/shell 观测当前世界。",
  schema: recallHistoryArgsSchema,
  execute(args, context): ToolResult {
    if (!context?.observationStore) return { success: false, error: "缺少历史遮罩仓库" };
    if (args.maskId) return recallByMaskId(args.maskId, context.observationStore, context.workspaceRoot);
    return searchByQuery(args.query ?? "", args.limit, context.observationStore);
  },
});

function hasLookupKey(args: RecallHistoryLookup): boolean {
  return Boolean(args.maskId?.trim() || args.query?.trim());
}

function recallByMaskId(
  maskId: string,
  store: ObservationStore,
  workspaceRoot: string,
): ToolResult {
  const recalled = store.recall(maskId.trim(), workspaceRoot);
  if (!recalled) return { success: false, error: `未知的历史遮罩: ${maskId}` };
  return { success: true, data: formatRecalledObservation(recalled) };
}

function searchByQuery(
  query: string,
  limit: number | undefined,
  store: ObservationStore,
): ToolResult {
  const masks = store.search(query, limit);
  if (masks.length === 0) return { success: false, error: `未找到匹配的历史遮罩: ${query}` };
  return { success: true, data: formatSearchResults(masks) };
}

function formatRecalledObservation(recalled: RecalledObservation): string {
  return JSON.stringify({
    maskId: recalled.mask.id,
    toolName: recalled.mask.toolName,
    freshness: recalled.freshness,
    source: recalled.mask.source,
    summary: recalled.mask.summary,
    originalText: recalled.mask.originalText,
  }, null, 2);
}

function formatSearchResults(masks: ObservationMask[]): string {
  return JSON.stringify({
    results: masks.map((mask) => ({
      maskId: mask.id,
      toolName: mask.toolName,
      source: mask.source,
      summary: mask.summary,
    })),
  }, null, 2);
}

export default recallHistory;
