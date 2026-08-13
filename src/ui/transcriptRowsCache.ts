import type { ChatEntry } from "./hooks/index.js";
import {
  buildTranscriptEntryRows,
  buildTranscriptHeaderRows,
  buildTranscriptStreamingRows,
  type BuildTranscriptRowsInput,
  type TranscriptHeader,
  type TranscriptRow,
} from "./transcriptRows.js";

export interface TranscriptRowsCache {
  width: number;
  headerSignature: string;
  headerRows: TranscriptRow[];
  entryRowsById: Map<string, TranscriptRow[]>;
  entryIds: string[];
  completedRows: TranscriptRow[];
}

export function createTranscriptRowsCache(): TranscriptRowsCache {
  return {
    width: -1,
    headerSignature: "",
    headerRows: [],
    entryRowsById: new Map(),
    entryIds: [],
    completedRows: [],
  };
}

export function buildCachedTranscriptRows(
  cache: TranscriptRowsCache,
  input: BuildTranscriptRowsInput,
): TranscriptRow[] {
  ensureWidthCache(cache, input.width);
  updateHeaderRows(cache, input.header, input.width);
  updateCompletedRows(cache, input.entries, input.width);
  return [
    ...cache.headerRows,
    ...cache.completedRows,
    ...buildTranscriptStreamingRows(input),
  ];
}

function getHeaderSignature(header: TranscriptHeader | undefined): string {
  if (!header) return "";
  return [
    header.version,
    header.model,
    header.thinking ? "1" : "0",
    header.reasoningEffort,
    header.path,
  ].join("\0");
}

function ensureWidthCache(cache: TranscriptRowsCache, width: number): void {
  if (cache.width === width) return;
  cache.width = width;
  cache.headerSignature = "";
  cache.headerRows = [];
  cache.entryRowsById = new Map();
  cache.entryIds = [];
  cache.completedRows = [];
}

function updateHeaderRows(
  cache: TranscriptRowsCache,
  header: TranscriptHeader | undefined,
  width: number,
): void {
  const signature = getHeaderSignature(header);
  if (cache.headerSignature === signature) return;
  cache.headerSignature = signature;
  cache.headerRows = header ? buildTranscriptHeaderRows({ header, width }) : [];
}

function updateCompletedRows(
  cache: TranscriptRowsCache,
  entries: readonly ChatEntry[],
  width: number,
): void {
  if (!canReuseEntryRows(cache, entries)) resetEntryRows(cache);
  appendMissingEntryRows(cache, entries, width);
}

function canReuseEntryRows(
  cache: TranscriptRowsCache,
  entries: readonly ChatEntry[],
): boolean {
  if (entries.length < cache.entryIds.length) return false;
  return cache.entryIds.every((id, index) => entries[index]?.id === id);
}

function resetEntryRows(cache: TranscriptRowsCache): void {
  cache.entryRowsById = new Map();
  cache.entryIds = [];
  cache.completedRows = [];
}

function appendMissingEntryRows(
  cache: TranscriptRowsCache,
  entries: readonly ChatEntry[],
  width: number,
): void {
  for (let index = cache.entryIds.length; index < entries.length; index++) {
    const entry = entries[index]!;
    const rows = buildTranscriptEntryRows({ entry, width });
    cache.entryRowsById.set(entry.id, rows);
    cache.entryIds.push(entry.id);
    cache.completedRows.push(...rows);
  }
}
