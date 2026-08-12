import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const MAX_FUNCTION_LINES = 20;
const MAX_FUNCTION_PARAMS = 3;

interface FunctionMetric {
  key: string;
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
  ["src/agent/loop.ts:runAgentLoop#1"]: { lines: 29, params: 1 },
  ["src/agent/loop.ts:consumeStreamEvent#1"]: { lines: 24, params: 2 },
  ["src/agent/loop.ts:emitToolExecution#1"]: { lines: 20, params: 4 },
  ["src/agent/loop.ts:emitToolFailure#1"]: { lines: 18, params: 5 },
  ["src/agent/loop.ts:logToolStart#1"]: { lines: 8, params: 4 },
  ["src/agent/loop.ts:logToolEnd#1"]: { lines: 14, params: 4 },
  ["src/agent/prompt.ts:buildSystemPrompt#1"]: { lines: 22, params: 0 },
  ["src/llm/client.ts:toOpenAIMessages#1"]: { lines: 21, params: 1 },
  ["src/llm/client.ts:streamChat#1"]: { lines: 21, params: 1 },
  ["src/test/generator-demo.ts:agentStreamChat#1"]: { lines: 25, params: 0 },
  ["src/test/generator-demo.ts:runAgentLoop#1"]: { lines: 39, params: 0 },
  ["src/tools/edit.ts:findMatches#1"]: { lines: 26, params: 4 },
  ["src/tools/edit.ts:applyMatches#1"]: { lines: 18, params: 5 },
  ["src/tools/fileState.ts:createSnippet#1"]: { lines: 19, params: 5 },
  ["src/tools/fileState.ts:buildDiffPreview#1"]: { lines: 21, params: 3 },
  ["src/tools/listDir.ts:formatDirectoryEntry#1"]: { lines: 14, params: 4 },
  ["src/tools/read.ts:buildReadResult#1"]: { lines: 34, params: 3 },
  ["src/tools/read.ts:parseReadRange#1"]: { lines: 33, params: 3 },
  ["src/tools/rename.ts:parseRenameArgs#1"]: { lines: 25, params: 1 },
  ["src/tools/shellRunner.ts:runShellCommand#1"]: { lines: 26, params: 1 },
  ["src/tools/shellRunner.ts:waitForProcess#1"]: { lines: 34, params: 2 },
  ["src/tools/shellRunner.ts:<anonymous>#1"]: { lines: 23, params: 1 },
  ["src/tools/shellRunner.ts:killProcessTree#1"]: { lines: 26, params: 1 },
  ["src/tools/shellRunner.ts:buildCompletedResult#1"]: { lines: 33, params: 5 },
  ["src/tools/shellRunner.ts:buildSpawnErrorResult#1"]: { lines: 23, params: 2 },
  ["src/tools/write.ts:parseWriteArgs#1"]: { lines: 22, params: 1 },
  ["src/ui/App.tsx:App#1"]: { lines: 127, params: 1 },
  ["src/ui/App.tsx:ContextUsageFooter#1"]: { lines: 23, params: 1 },
  ["src/ui/LogViewer.tsx:LogViewer#1"]: { lines: 78, params: 0 },
  ["src/ui/LogViewer.tsx:<anonymous>#1"]: { lines: 33, params: 0 },
  ["src/ui/LogViewer.tsx:poll#1"]: { lines: 21, params: 0 },
  ["src/ui/SetupWizard.tsx:SetupWizard#1"]: { lines: 117, params: 1 },
  ["src/ui/SetupWizard.tsx:applyStepValue#1"]: { lines: 30, params: 0 },
  ["src/ui/SetupWizard.tsx:StepContent#1"]: { lines: 58, params: 1 },
  ["src/ui/SetupWizard.tsx:PromptRow#1"]: { lines: 46, params: 1 },
  ["src/ui/components/Header/Header.tsx:Header#1"]: { lines: 43, params: 1 },
  ["src/ui/components/InputBox/InputBox.tsx:InputBox#1"]: { lines: 48, params: 1 },
  ["src/ui/components/InputBox/inputBoxModel.ts:resolveInputBoxCommand#1"]: { lines: 40, params: 2 },
  ["src/ui/components/InputBox/inputBoxModel.ts:reduceInputBoxState#1"]: { lines: 40, params: 3 },
  ["src/ui/components/InputBox/inputBoxModel.ts:moveCursorBy#1"]: { lines: 23, params: 2 },
  ["src/ui/components/InputBox/textEditor.ts:<anonymous>#2"]: { lines: 27, params: 2 },
  ["src/ui/components/InputBox/useInputBoxController.ts:useInputBoxController#1"]: { lines: 65, params: 1 },
  ["src/ui/components/MessageList/MessageList.tsx:MessageList#1"]: { lines: 38, params: 1 },
  ["src/ui/components/MessageList/MessageList.tsx:MessageRow#1"]: { lines: 22, params: 1 },
  ["src/ui/components/TranscriptViewport/TranscriptViewport.tsx:useTranscriptViewportController#1"]: { lines: 53, params: 1 },
  ["src/ui/components/TranscriptViewport/TranscriptViewport.tsx:getRenderScrollState#1"]: { lines: 26, params: 3 },
  ["src/ui/components/TranscriptViewport/TranscriptViewport.tsx:TranscriptViewport#1"]: { lines: 37, params: 1 },
  ["src/ui/components/TranscriptViewport/TranscriptViewport.tsx:<anonymous>#5"]: { lines: 22, params: 1 },
  ["src/ui/contextUsage.ts:formatContextUsageBar#1"]: { lines: 22, params: 2 },
  ["src/ui/contextUsage.ts:selectContextUsageView#1"]: { lines: 23, params: 2 },
  ["src/ui/hooks/useChat.ts:useChat#1"]: { lines: 73, params: 1 },
  ["src/ui/hooks/useChat.ts:sendMessage#1"]: { lines: 22, params: 1 },
  ["src/ui/hooks/useChat.ts:consumeAgentEvent#1"]: { lines: 33, params: 3 },
  ["src/ui/hooks/useChat.ts:appendError#1"]: { lines: 21, params: 3 },
  ["src/ui/hooks/useChatInputRouter.ts:routeChatInput#1"]: { lines: 28, params: 3 },
  ["src/ui/hooks/useChatInputRouter.ts:useChatInputRouter#1"]: { lines: 43, params: 1 },
  ["src/ui/hooks/useChatInputRouter.ts:getKeyboardScrollAction#1"]: { lines: 31, params: 3 },
  ["src/ui/hooks/useExit.ts:useExit#1"]: { lines: 38, params: 1 },
  ["src/ui/toolDisplay.ts:formatToolDisplay#1"]: { lines: 23, params: 1 },
  ["src/ui/toolDisplay.ts:getToolTarget#1"]: { lines: 25, params: 1 },
  ["src/ui/transcriptRows.ts:buildTranscriptRows#1"]: { lines: 25, params: 1 },
  ["src/ui/transcriptRows.ts:appendHeaderRows#1"]: { lines: 21, params: 3 },
  ["src/ui/transcriptRows.ts:createHeaderTitleRow#1"]: { lines: 22, params: 2 },
  ["src/ui/transcriptRows.ts:truncateByColumns#1"]: { lines: 21, params: 2 },
  ["src/ui/transcriptRows.ts:appendEntryRows#1"]: { lines: 25, params: 3 },
  ["src/ui/transcriptRows.ts:getTextEntryRowConfig#1"]: { lines: 21, params: 1 },
  ["src/ui/transcriptRows.ts:appendThinkingRows#1"]: { lines: 17, params: 4 },
  ["src/ui/transcriptRows.ts:appendAssistantTurnRows#1"]: { lines: 27, params: 3 },
  ["src/ui/transcriptRows.ts:appendWrappedRows#1"]: { lines: 25, params: 2 },
  ["src/ui/transcriptRows.ts:wrapLogicalLine#1"]: { lines: 25, params: 2 },
  ["src/ui/transcriptRows.ts:wrapLogicalLineWithFirstWidth#1"]: { lines: 30, params: 3 },
  ["src/ui/transcriptScroll.ts:getNextOffset#1"]: { lines: 21, params: 4 },
};

test("new functions stay within project size limits", () => {
  const violations = collectFunctionMetrics("src")
    .filter(isStyleViolation)
    .filter(isUnexpectedOrWorseViolation);

  assert.deepEqual(violations, []);
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
    lines: getLineCount(context.sourceFile, node),
    params: node.parameters.length,
  };
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
  return metric.lines > MAX_FUNCTION_LINES || metric.params > MAX_FUNCTION_PARAMS;
}

function isUnexpectedOrWorseViolation(metric: FunctionMetric): boolean {
  const allowed = LEGACY_VIOLATIONS[metric.key];
  if (!allowed) return true;
  return metric.lines > allowed.lines || metric.params > allowed.params;
}

function toSlashPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
