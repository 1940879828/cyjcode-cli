import fs from "node:fs";
import path from "node:path";
import type { InvalidSkillInfo, SkillInfo, SkillSearchResult } from "./types.js";

const LISTING_BUDGET = 8000;
const RESOURCE_LIMIT = 50;
const EXCLUDED_RESOURCE_DIRS = new Set([".git", "dist", "build", "coverage", "node_modules", "out"]);

export function buildSkillListingPrompt(skills: SkillInfo[], candidates: SkillSearchResult[] = []): string {
  const ordered = orderListingSkills(skills, candidates);
  const lines: string[] = [];
  for (const skill of ordered) {
    const line = formatSkillListingLine(skill);
    if ([...lines, line].join("\n").length > LISTING_BUDGET) break;
    lines.push(line);
  }
  if (lines.length === 0) return "";
  return `<skill_listing>\n${lines.join("\n")}\n</skill_listing>`;
}

export function buildSkillInjectionPrompt(skill: SkillInfo, args = "", reason = "manual"): string {
  const attrs = [
    `name="${escapeXml(skill.name)}"`,
    `path="${escapeXml(skill.path)}"`,
    `source="${skill.source}"`,
    `mode="${skill.context}"`,
    `trigger="${escapeXml(reason)}"`,
  ];
  const argumentsBlock = args.trim() ? `\n<arguments>${escapeXml(args.trim())}</arguments>` : "";
  return `<loaded_skill ${attrs.join(" ")}>${argumentsBlock}
${buildMetadataBlock(skill)}
<instructions>
${skill.rawContent ?? skill.content}
</instructions>${buildResourceBlock(skill)}
</loaded_skill>`;
}

export function formatSkillsForDisplay(skills: Array<SkillInfo | InvalidSkillInfo>): string {
  if (skills.length === 0) return "没有发现可用 skills。";
  return ["可用 skills:", "", ...skills.map(formatSkillDisplayLine)].join("\n");
}

function orderListingSkills(skills: SkillInfo[], candidates: SkillSearchResult[]): SkillInfo[] {
  const candidateScore = new Map(candidates.map((candidate) => [candidate.skill.name, candidate.score]));
  return [...skills].sort((left, right) =>
    Number(Boolean(right.loaded)) - Number(Boolean(left.loaded)) ||
    (candidateScore.get(right.name) ?? 0) - (candidateScore.get(left.name) ?? 0) ||
    sourceRank(left) - sourceRank(right) ||
    left.name.localeCompare(right.name),
  );
}

function formatSkillListingLine(skill: SkillInfo): string {
  const names = skill.displayName ? `${skill.name} / ${skill.displayName}` : skill.name;
  const useText = skill.whenToUse ? ` Use when: ${skill.whenToUse}` : "";
  return `- ${names}: ${skill.description}${useText}`;
}

function formatSkillDisplayLine(skill: SkillInfo | InvalidSkillInfo): string {
  const status = "invalid" in skill ? "invalid" : skill.loaded ? "loaded" : "available";
  const label = formatSkillLabel(skill);
  return `  /${label.padEnd(24)} [${skill.source}, ${status}] ${formatSkillDisplayDescription(skill)}`;
}

function formatSkillLabel(skill: SkillInfo | InvalidSkillInfo): string {
  return "displayName" in skill && skill.displayName ? `${skill.name} (${skill.displayName})` : skill.name;
}

function formatSkillDisplayDescription(skill: SkillInfo | InvalidSkillInfo): string {
  return "invalid" in skill ? `${skill.description}: ${skill.error ?? "unknown error"}` : skill.description;
}

function buildMetadataBlock(skill: SkillInfo): string {
  return [
    "<metadata>",
    `  <allowed_tools>${escapeXml(skill.allowedTools.join(", "))}</allowed_tools>`,
    `  <context>${skill.context}</context>`,
    ...optionalMetadataLines(skill),
    "</metadata>",
  ].join("\n");
}

function optionalMetadataLines(skill: SkillInfo): string[] {
  return [
    skill.model ? `  <model>${escapeXml(skill.model)}</model>` : "",
    skill.effort ? `  <effort>${escapeXml(skill.effort)}</effort>` : "",
  ].filter((line) => line !== "");
}

function buildResourceBlock(skill: SkillInfo): string {
  const resources = listSkillResources(skill);
  if (resources.length === 0) return "";
  return `\n<resources>\n${resources.map((file) => `  <file>${escapeXml(file)}</file>`).join("\n")}\n</resources>`;
}

function listSkillResources(skill: SkillInfo): string[] {
  if (!skill.skillFilePath) return [];
  const skillDir = path.dirname(skill.skillFilePath);
  const files: string[] = [];
  visitResourceDir(skillDir, "", files);
  return files.slice(0, RESOURCE_LIMIT);
}

function visitResourceDir(dir: string, relativeDir: string, files: string[]): void {
  if (files.length >= RESOURCE_LIMIT) return;
  for (const entry of safeReadDir(dir)) {
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (shouldSkipResource(entry, relativePath)) continue;
    if (entry.isDirectory()) visitResourceDir(path.join(dir, entry.name), relativePath, files);
    else if (entry.isFile()) files.push(toPosixPath(relativePath));
  }
}

function shouldSkipResource(entry: fs.Dirent, relativePath: string): boolean {
  return entry.name.startsWith(".") || entry.name === "SKILL.md" ||
    (entry.isDirectory() && EXCLUDED_RESOURCE_DIRS.has(entry.name)) ||
    relativePath.split(path.sep).some((part) => EXCLUDED_RESOURCE_DIRS.has(part));
}

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function sourceRank(skill: SkillInfo): number {
  return skill.source === "project" ? 0 : skill.source === "user" ? 1 : 2;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
