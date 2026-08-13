import fs from "node:fs";
import path from "node:path";
import type { ToolResult } from "../types.js";
import { matchesGlob, parseFileTypes, splitGlobPatterns } from "./globPattern.js";
import {
  emptyGlobResult,
  emptyGrepResult,
  formatRelativePath,
  formatResultData,
  limitResults,
  toSlashPath,
} from "./searchResult.js";
import {
  EXCLUDED_DIRECTORIES,
  MAX_FILE_SIZE_BYTES,
  MAX_LINE_LENGTH,
  MAX_SCAN_FILES,
  type FileCandidate,
  type SearchArgs,
} from "./searchTypes.js";

export function grepWithNode(args: SearchArgs): ToolResult {
  const regex = buildNodeRegex(args);
  const matches = listFileCandidates(args.resolvedPath)
    .filter((file) => shouldSearchFile(file, args))
    .flatMap((file) => grepFile(file, regex, args));
  const limited = limitResults(matches, args.maxResults);

  return {
    success: true,
    data: limited.items.length > 0 ? formatResultData(limited.items, limited.truncated) : emptyGrepResult(args.outputMode).data,
    metadata: {
      mode: "grep",
      outputMode: args.outputMode,
      truncated: limited.truncated,
      resultCount: limited.items.length,
    },
  };
}

export function globWithNode(args: SearchArgs): ToolResult {
  const matches = listFileCandidates(args.resolvedPath)
    .filter((file) => matchesGlob(file.matchPath, args.pattern))
    .map((file) => file.relativePath);
  const limited = limitResults(matches, args.maxResults);

  return {
    success: true,
    data: limited.items.length > 0 ? formatResultData(limited.items, limited.truncated) : emptyGlobResult().data,
    metadata: {
      mode: "glob",
      truncated: limited.truncated,
      resultCount: limited.items.length,
    },
  };
}

function buildNodeRegex(args: SearchArgs): RegExp {
  return new RegExp(args.pattern, args.caseInsensitive ? "i" : "");
}

function shouldSearchFile(file: FileCandidate, args: SearchArgs): boolean {
  const allowedTypes = parseFileTypes(args.fileTypes);
  const globPatterns = splitGlobPatterns(args.glob);
  const fileTypeMatches =
    allowedTypes.length === 0 || allowedTypes.includes(path.extname(file.absolutePath));
  const globMatches =
    globPatterns.length === 0 ||
    globPatterns.some((globPattern) => matchesGlob(file.matchPath, globPattern));

  return fileTypeMatches && globMatches && isReadableTextFile(file.absolutePath);
}

function grepFile(file: FileCandidate, regex: RegExp, args: SearchArgs): string[] {
  const text = fs.readFileSync(file.absolutePath, "utf-8");
  const lines = text.split(/\r?\n/);
  const matchingLineIndexes = lines.flatMap((line, index) => {
    regex.lastIndex = 0;
    return regex.test(line) ? [index] : [];
  });

  if (args.outputMode === "files") {
    return matchingLineIndexes.length > 0 ? [file.relativePath] : [];
  }
  if (args.outputMode === "count") {
    return matchingLineIndexes.length > 0 ? [`${file.relativePath}:${matchingLineIndexes.length}`] : [];
  }

  return matchingLineIndexes.map((index) => {
    const line = lines[index] ?? "";
    return `${file.relativePath}:${index + 1}: ${line.trim().slice(0, MAX_LINE_LENGTH)}`;
  });
}

function listFileCandidates(targetPath: string): FileCandidate[] {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return [{
      absolutePath: targetPath,
      relativePath: formatRelativePath(targetPath),
      matchPath: path.basename(targetPath),
    }];
  }

  const files: FileCandidate[] = [];
  collectFileCandidates(targetPath, targetPath, files);
  return files;
}

function collectFileCandidates(rootPath: string, currentPath: string, files: FileCandidate[]): void {
  if (files.length >= MAX_SCAN_FILES) return;

  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
      collectFileCandidates(rootPath, absolutePath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push({
        absolutePath,
        relativePath: formatRelativePath(absolutePath),
        matchPath: toSlashPath(path.relative(rootPath, absolutePath)),
      });
    }
  }
}

function isReadableTextFile(filePath: string): boolean {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE_BYTES) return false;

  const sample = Buffer.alloc(Math.min(stat.size, 1024));
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, sample, 0, sample.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  return !sample.includes(0);
}
