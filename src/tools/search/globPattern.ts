import path from "node:path";
import { toSlashPath } from "./searchResult.js";

export function parseFileTypes(fileTypes: string | undefined): string[] {
  return fileTypes
    ? fileTypes.split(",").map(normalizeFileType).filter(Boolean)
    : [];
}

export function splitGlobPatterns(glob: string | undefined): string[] {
  if (!glob) return [];

  return glob
    .split(/\s+/)
    .flatMap((part) => (part.includes("{") && part.includes("}") ? [part] : part.split(",")))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function matchesGlob(relativePath: string, globPattern: string): boolean {
  const normalizedPath = toSlashPath(relativePath);
  const normalizedPattern = toSlashPath(globPattern);
  const target = normalizedPattern.includes("/") ? normalizedPath : path.posix.basename(normalizedPath);
  return globToRegex(normalizedPattern).test(target);
}

function normalizeFileType(fileType: string): string {
  const trimmed = fileType.trim();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function globToRegex(globPattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < globPattern.length; index += 1) {
    const token = readGlobToken(globPattern, index);
    source += token.source;
    index = token.nextIndex;
  }

  return new RegExp(`${source}$`);
}

function readGlobToken(globPattern: string, index: number): { source: string; nextIndex: number } {
  const char = globPattern[index];
  if (char === "*" && globPattern[index + 1] === "*") return readDoubleStar(globPattern, index);
  if (char === "*") return { source: "[^/]*", nextIndex: index };
  if (char === "?") return { source: "[^/]", nextIndex: index };
  if (char === "{") return readGlobAlternates(globPattern, index);
  return { source: escapeRegex(char ?? ""), nextIndex: index };
}

function readDoubleStar(globPattern: string, index: number): { source: string; nextIndex: number } {
  const nextIndex = globPattern[index + 2] === "/" ? index + 2 : index + 1;
  const source = globPattern[index + 2] === "/" ? "(?:.*/)?" : ".*";
  return { source, nextIndex };
}

function readGlobAlternates(globPattern: string, index: number): { source: string; nextIndex: number } {
  const end = globPattern.indexOf("}", index + 1);
  if (end === -1) return { source: escapeRegex("{"), nextIndex: index };

  const source = globPattern
    .slice(index + 1, end)
    .split(",")
    .map(escapeRegex)
    .join("|");
  return { source: `(?:${source})`, nextIndex: end };
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
