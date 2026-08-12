import path from "node:path";

export function isInsideWorkspace(
  candidatePath: string,
  workspaceRoot = process.cwd(),
): boolean {
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedWorkspace, resolvedCandidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function resolveInsideWorkspace(
  inputPath: string,
): { success: true; path: string } | { success: false; error: string } {
  const resolved = path.resolve(inputPath);
  if (!isInsideWorkspace(resolved)) {
    return {
      success: false,
      error: `路径穿越拒绝: ${inputPath}`,
    };
  }
  return { success: true, path: resolved };
}
