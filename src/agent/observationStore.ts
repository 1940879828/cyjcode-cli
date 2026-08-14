import fs from "node:fs";
import { contentFingerprint } from "../utils/contentFingerprint.js";
import { isInsideWorkspace } from "../tools/workspacePath.js";

export type ObservationFreshness = "fresh" | "stale" | "unknown";

export interface FileObservationSource {
  kind: "file";
  filePath: string;
  contentFingerprint: string;
}

export interface UnknownObservationSource {
  kind: "unknown";
}

export type ObservationSource = FileObservationSource | UnknownObservationSource;

export interface ObservationMask {
  id: string;
  toolName: string;
  summary: string;
  originalText: string;
  source: ObservationSource;
  createdAt: number;
}

export interface RecalledObservation {
  mask: ObservationMask;
  freshness: ObservationFreshness;
}

export interface ObservationStore {
  put(mask: ObservationMask): void;
  get(maskId: string): ObservationMask | undefined;
  search(query: string, limit?: number): ObservationMask[];
  recall(maskId: string, workspaceRoot: string): RecalledObservation | undefined;
}

export function createObservationStore(): ObservationStore {
  const masks = new Map<string, ObservationMask>();
  return {
    put: (mask) => masks.set(mask.id, mask),
    get: (maskId) => masks.get(maskId),
    search: (query, limit) => searchMasks(masks, query, limit),
    recall: (maskId, workspaceRoot) => recallMask(masks.get(maskId), workspaceRoot),
  };
}

function searchMasks(
  masks: Map<string, ObservationMask>,
  query: string,
  limit = 5,
): ObservationMask[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return Array.from(masks.values())
    .filter((mask) => matchesMask(mask, normalized))
    .slice(0, Math.max(1, limit));
}

function matchesMask(mask: ObservationMask, query: string): boolean {
  return [
    mask.id,
    mask.toolName,
    mask.summary,
    mask.originalText,
  ].some((value) => value.toLowerCase().includes(query));
}

function recallMask(
  mask: ObservationMask | undefined,
  workspaceRoot: string,
): RecalledObservation | undefined {
  if (!mask) return undefined;
  return { mask, freshness: getFreshness(mask.source, workspaceRoot) };
}

function getFreshness(
  source: ObservationSource,
  workspaceRoot: string,
): ObservationFreshness {
  if (source.kind !== "file") return "unknown";
  if (!isInsideWorkspace(source.filePath, workspaceRoot)) return "stale";
  if (!fs.existsSync(source.filePath)) return "stale";
  return hasSameFingerprint(source) ? "fresh" : "stale";
}

function hasSameFingerprint(source: FileObservationSource): boolean {
  try {
    const content = fs.readFileSync(source.filePath, "utf-8");
    return contentFingerprint(content) === source.contentFingerprint;
  } catch {
    return false;
  }
}
