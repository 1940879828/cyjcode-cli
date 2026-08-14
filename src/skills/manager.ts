import type { ChatMessage } from "../llm/types.js";
import { buildSkillInjectionPrompt, buildSkillListingPrompt, formatSkillsForDisplay } from "./prompt.js";
import { createSkillRegistry } from "./registry.js";
import { searchSkills } from "./search.js";
import {
  AUTO_INJECT_THRESHOLD,
  createSkillSessionState,
  restoreSkillSessionState,
  resetSkillSessionState,
  snapshotSkillSessionState,
  SUGGEST_THRESHOLD,
  type SkillLoadResult,
} from "./session.js";
import type {
  InvalidSkillInfo,
  SkillInfo,
  SkillRegistry,
  SkillSearchResult,
  SkillSessionSnapshot,
  SkillSessionState,
} from "./types.js";

export interface SkillManager {
  workspaceRoot: string;
  list(): SkillInfo[];
  routeUserMessage(text: string): ChatMessage[];
  load(name: string, args?: string, reason?: string): SkillLoadResult;
  formatStatus(): string;
  reset(): void;
  snapshot(): SkillSessionSnapshot;
  restore(snapshot: SkillSessionSnapshot): void;
  state: SkillSessionState;
}

interface SkillLoadRequest {
  name: string;
  args: string;
  reason: string;
  registry: SkillRegistry;
  state: SkillSessionState;
}

export function createSkillManager(workspaceRoot = process.cwd()): SkillManager {
  const state = createSkillSessionState();
  const registry = createSkillRegistry(workspaceRoot);
  return {
    workspaceRoot,
    list: () => registry.validSkills(),
    routeUserMessage: (text) => routeUserMessage(text, registry, state),
    load: (name, args = "", reason = "manual") => loadSkill({ name, args, reason, registry, state }),
    formatStatus: () => formatSkillsForDisplay(markLoadedRecords(registry.records(), state)),
    reset: () => resetSkillSessionState(state),
    snapshot: () => snapshotSkillSessionState(state),
    restore: (snapshot) => restoreSkillSessionState(state, snapshot),
    state,
  };
}

function routeUserMessage(text: string, registry: SkillRegistry, state: SkillSessionState): ChatMessage[] {
  const manual = parseSkillSlashInvocation(text, registry.validSkills());
  if (manual) return loadMessage({ name: manual.name, args: manual.args, reason: "manual", registry, state });
  const candidates = searchSkills(text, filterImplicitSkills(registry.validSkills(), state));
  state.lastCandidates = candidates.filter((candidate) => candidate.score >= SUGGEST_THRESHOLD);
  return [...candidateListingMessages(state.lastCandidates, state), ...autoInjectionMessages(candidates, registry, state)];
}

function loadSkill(input: SkillLoadRequest): SkillLoadResult {
  const { name, args, reason, registry, state } = input;
  const skill = registry.find(name);
  if (!skill) return { success: false, message: `未找到 skill: ${stripSlash(name)}` };
  if (state.loadedSkillNames.has(skill.name)) return alreadyLoaded(skill);
  state.loadedSkillNames.add(skill.name);
  if (args.trim()) state.manualSkillArgs.set(skill.name, args.trim());
  return skillLoaded(skill, args, reason);
}

function autoInjectionMessages(
  candidates: SkillSearchResult[],
  registry: SkillRegistry,
  state: SkillSessionState,
): ChatMessage[] {
  return candidates
    .filter((candidate) => candidate.score >= AUTO_INJECT_THRESHOLD)
    .flatMap((candidate) => loadMessage({
      name: candidate.skill.name,
      args: "",
      reason: "auto",
      registry,
      state,
    }));
}

function candidateListingMessages(candidates: SkillSearchResult[], state: SkillSessionState): ChatMessage[] {
  const mediumCandidates = candidates.filter((candidate) =>
    candidate.score < AUTO_INJECT_THRESHOLD && !state.suggestedSkillNames.has(candidate.skill.name)
  );
  const listing = buildSkillListingPrompt(mediumCandidates.map((candidate) => candidate.skill), mediumCandidates);
  for (const candidate of mediumCandidates) state.suggestedSkillNames.add(candidate.skill.name);
  return listing ? [{ role: "system", content: `相关 Skills 候选（可用 skill 工具按名称加载）:\n${listing}` }] : [];
}

function loadMessage(input: SkillLoadRequest): ChatMessage[] {
  const result = loadSkill(input);
  return result.injection ? [result.injection] : [];
}

function markLoadedRecords(
  records: ReturnType<SkillRegistry["records"]>,
  state: SkillSessionState,
): Array<SkillInfo | InvalidSkillInfo> {
  return records.map((record) => ({ ...record.skill, loaded: state.loadedSkillNames.has(record.skill.name) }));
}

function parseSkillSlashInvocation(input: string, skills: SkillInfo[]): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawName = "", ...restArgs] = trimmed.slice(1).split(/\s+/);
  const skill = skills.find((item) => item.userInvocable && item.name === rawName);
  return skill ? { name: skill.name, args: restArgs.join(" ") } : null;
}

function filterImplicitSkills(skills: SkillInfo[], state: SkillSessionState): SkillInfo[] {
  return skills.filter((skill) => skill.allowImplicitInvocation && !state.loadedSkillNames.has(skill.name));
}

function alreadyLoaded(skill: SkillInfo): SkillLoadResult {
  return {
    success: true,
    message: `skill 已加载，跳过重复注入: ${skill.name}`,
    skill: { ...skill, loaded: true },
  };
}

function skillLoaded(skill: SkillInfo, args: string, reason: string): SkillLoadResult {
  return {
    success: true,
    message: `已加载 skill: ${skill.name}`,
    injection: { role: "system", content: buildSkillInjectionPrompt(skill, args, reason) },
    skill: { ...skill, loaded: true },
  };
}

function stripSlash(name: string): string {
  return name.trim().replace(/^\//, "");
}
