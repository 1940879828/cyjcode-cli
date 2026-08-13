import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const FUNCTION_LIMITS: Record<FunctionKind, FunctionLimit> = {
  function: { lines: 20, params: 3 },
  component: { lines: 60, params: 3 },
  hook: { lines: 60, params: 3 },
};

type FunctionKind = "function" | "component" | "hook";

interface FunctionMetric {
  key: string;
  kind: FunctionKind;
  lines: number;
  params: number;
}

interface FunctionLimit {
  lines: number;
  params: number;
}

interface MetricReadContext {
  sourceFile: ts.SourceFile;
  filePath: string;
  nameCounts: Map<string, number>;
  metrics: FunctionMetric[];
}

const LEGACY_VIOLATIONS: Record<string, { lines: number; params: number }> = {
  ["src/ui/App.tsx:App#1"]: { lines: 129, params: 1 },
  ["src/ui/SetupWizard.tsx:SetupWizard#1"]: { lines: 105, params: 1 },
};

test("new functions stay within project size limits", () => {
  const metrics = collectFunctionMetrics("src");
  const violations = metrics
    .filter(isStyleViolation)
    .filter(isUnexpectedOrWorseViolation);

  assert.deepEqual(violations, []);
  assert.deepEqual(findStaleLegacyViolations(metrics), []);
});

function collectFunctionMetrics(rootPath: string): FunctionMetric[] {
  return listSourceFiles(rootPath).flatMap(readFunctionMetrics);
}

function listSourceFiles(rootPath: string): string[] {
  return fs.readdirSync(rootPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function readFunctionMetrics(filePath: string): FunctionMetric[] {
  const sourceText = fs.readFileSync(filePath, "utf-8");
  const sourceFile = createSourceFile(filePath, sourceText);
  const metrics: FunctionMetric[] = [];
  const nameCounts = new Map<string, number>();

  visitSourceFile({ sourceFile, filePath, nameCounts, metrics });
  return metrics;
}

function createSourceFile(filePath: string, sourceText: string): ts.SourceFile {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}

function visitSourceFile(context: MetricReadContext): void {
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) context.metrics.push(readFunctionMetric(context, node));
    ts.forEachChild(node, visit);
  };
  visit(context.sourceFile);
}

function isFunctionLike(node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function readFunctionMetric(
  context: MetricReadContext,
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): FunctionMetric {
  const name = getFunctionName(node);
  const occurrence = (context.nameCounts.get(name) ?? 0) + 1;
  context.nameCounts.set(name, occurrence);

  return {
    key: `${toSlashPath(context.filePath)}:${name}#${occurrence}`,
    kind: getFunctionKind(name),
    lines: getLineCount(context.sourceFile, node),
    params: node.parameters.length,
  };
}

function getFunctionKind(name: string): FunctionKind {
  if (isHookName(name)) return "hook";
  if (isComponentName(name)) return "component";
  return "function";
}

function isHookName(name: string): boolean {
  return /^use[A-Z0-9]/.test(name);
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function getFunctionName(node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction): string {
  if (hasFunctionName(node)) return node.name.text;
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<anonymous>";
}

function hasFunctionName(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): node is ts.FunctionDeclaration | ts.FunctionExpression {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && Boolean(node.name);
}

function getLineCount(sourceFile: ts.SourceFile, node: ts.Node): number {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const end = sourceFile.getLineAndCharacterOfPosition(node.end).line;
  return end - start + 1;
}

function isStyleViolation(metric: FunctionMetric): boolean {
  const limit = FUNCTION_LIMITS[metric.kind];
  return metric.lines > limit.lines || metric.params > limit.params;
}

function isUnexpectedOrWorseViolation(metric: FunctionMetric): boolean {
  const allowed = LEGACY_VIOLATIONS[metric.key];
  if (!allowed) return true;
  return metric.lines > allowed.lines || metric.params > allowed.params;
}

function findStaleLegacyViolations(metrics: FunctionMetric[]): string[] {
  const metricByKey = new Map(metrics.map((metric) => [metric.key, metric]));
  return Object.entries(LEGACY_VIOLATIONS)
    .filter(([key, allowed]) => isLegacyEntryStale(metricByKey.get(key), allowed))
    .map(([key]) => key);
}

function isLegacyEntryStale(
  metric: FunctionMetric | undefined,
  allowed: { lines: number; params: number },
): boolean {
  if (!metric) return true;
  const stillViolates = isStyleViolation(metric);
  const improved = metric.lines < allowed.lines || metric.params < allowed.params;
  return !stillViolates || improved;
}

function toSlashPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
