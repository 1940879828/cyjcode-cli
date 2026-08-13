export const DEFAULT_MAX_RESULTS = 100;
export const MAX_RESULTS_LIMIT = 1000;
export const MAX_SCAN_FILES = 5000;
export const MAX_FILE_SIZE_BYTES = 1024 * 1024;
export const MAX_LINE_LENGTH = 500;
export const RG_TIMEOUT_MS = 10000;
export const RG_MAX_BUFFER = 10 * 1024 * 1024;
export const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".jj",
  ".sl",
  "node_modules",
  "dist",
  ".babel-out",
]);

export type SearchMode = "grep" | "glob";
export type GrepOutputMode = "content" | "files" | "count";

export interface SearchArgs {
  mode: SearchMode;
  pattern: string;
  searchPath: string;
  resolvedPath: string;
  glob?: string;
  fileTypes?: string;
  outputMode: GrepOutputMode;
  caseInsensitive: boolean;
  maxResults: number;
}

export interface FileCandidate {
  absolutePath: string;
  relativePath: string;
  matchPath: string;
}
