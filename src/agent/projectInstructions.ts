import fs from "node:fs";
import path from "node:path";

export const PROJECT_INSTRUCTIONS_FILE = "AGENTS.md";

export interface ProjectInstructions {
  filePath: string;
  content: string;
}

export function loadProjectInstructions(startDir = process.cwd()): ProjectInstructions | null {
  const filePath = findProjectInstructionsPath(startDir);
  if (!filePath) return null;

  const content = fs.readFileSync(filePath, "utf8").trim();
  return content ? { filePath, content } : null;
}

export function findProjectInstructionsPath(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const rootDir = path.parse(currentDir).root;

  while (true) {
    const candidate = path.join(currentDir, PROJECT_INSTRUCTIONS_FILE);
    if (isFile(candidate)) return candidate;
    if (currentDir === rootDir) return null;
    currentDir = path.dirname(currentDir);
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
