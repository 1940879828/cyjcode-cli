import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { bundledSkillFiles } from "./bundled/index.js";
import type { InvalidSkillInfo, SkillFrontmatter, SkillInfo, SkillRecord, SkillSource } from "./types.js";

interface SkillRoot {
  root: string;
  displayRoot: string;
  source: SkillSource;
}

export function loadSkills(workspaceRoot = process.cwd()): SkillInfo[] {
  return loadSkillRecords(workspaceRoot)
    .filter((record): record is { status: "valid"; skill: SkillInfo } => record.status === "valid")
    .map((record) => record.skill);
}

export function loadSkillRecords(workspaceRoot = process.cwd()): SkillRecord[] {
  const byName = new Map<string, SkillRecord>();
  for (const root of getSkillRoots(workspaceRoot)) {
    for (const record of readRootSkills(root)) {
      if (!byName.has(record.skill.name)) byName.set(record.skill.name, record);
    }
  }
  for (const record of readBundledSkills()) {
    if (!byName.has(record.skill.name)) byName.set(record.skill.name, record);
  }
  return [...byName.values()].sort(compareRecords);
}

export function findSkill(name: string, workspaceRoot = process.cwd()): SkillInfo | undefined {
  const normalized = normalizeSkillName(name);
  return loadSkills(workspaceRoot).find((skill) => skill.name === normalized);
}

function getSkillRoots(workspaceRoot: string): SkillRoot[] {
  const home = os.homedir();
  return [
    { root: path.join(workspaceRoot, ".tigacode", "skills"), displayRoot: "./.tigacode/skills", source: "project" },
    { root: path.join(workspaceRoot, ".agents", "skills"), displayRoot: "./.agents/skills", source: "project" },
    { root: path.join(home, ".tigacode", "skills"), displayRoot: "~/.tigacode/skills", source: "user" },
    { root: path.join(home, ".agents", "skills"), displayRoot: "~/.agents/skills", source: "user" },
  ];
}

function readRootSkills(root: SkillRoot): SkillRecord[] {
  return safeReadDir(root.root)
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => readDiskSkill(root, entry.name))
    .filter((record): record is SkillRecord => record !== null);
}

function readDiskSkill(root: SkillRoot, directoryName: string): SkillRecord | null {
  const skillFilePath = path.join(root.root, directoryName, "SKILL.md");
  if (!isReadableFile(skillFilePath)) return null;
  const raw = fs.readFileSync(skillFilePath, "utf8");
  return parseSkillSafely(raw, {
    directoryName,
    displayPath: `${root.displayRoot}/${directoryName}/SKILL.md`,
    source: root.source,
    skillFilePath,
  });
}

function readBundledSkills(): SkillRecord[] {
  return bundledSkillFiles.map((skill) =>
    parseSkillSafely(skill.content, {
      directoryName: skill.directoryName,
      displayPath: skill.displayPath,
      source: "bundled",
    }),
  );
}

function parseSkillSafely(
  raw: string,
  input: { directoryName: string; displayPath: string; source: SkillSource; skillFilePath?: string },
): SkillRecord {
  try {
    return { status: "valid", skill: parseSkill(raw, input) };
  } catch (error) {
    return { status: "invalid", skill: createInvalidSkill(input, toErrorMessage(error)) };
  }
}

function parseSkill(
  raw: string,
  input: { directoryName: string; displayPath: string; source: SkillSource; skillFilePath?: string },
): SkillInfo {
  assertFrontmatterBoundary(raw);
  const parsed = matter(raw);
  assertFrontmatterParsed(raw, parsed.data, parsed.content);
  const frontmatter = parsed.data as SkillFrontmatter;
  const name = normalizeSkillName(stringValue(frontmatter.name) || input.directoryName);
  const fields = parseSkillFields(frontmatter);
  return {
    name,
    ...fields,
    source: input.source,
    path: input.displayPath,
    content: parsed.content.trim(),
    rawContent: raw.trim(),
    skillFilePath: input.skillFilePath,
  };
}

function createInvalidSkill(
  input: { directoryName: string; displayPath: string; source: SkillSource; skillFilePath?: string },
  error: string,
): InvalidSkillInfo {
  return {
    name: normalizeSkillName(input.directoryName),
    description: "Invalid SKILL.md",
    source: input.source,
    path: input.displayPath,
    skillFilePath: input.skillFilePath,
    invalid: true,
    error,
  };
}

function parseSkillFields(frontmatter: SkillFrontmatter): Omit<SkillInfo, "name" | "source" | "path" | "content" | "skillFilePath"> {
  return {
    displayName: stringValue(frontmatter.display_name),
    description: stringValue(frontmatter.description) ?? "",
    aliases: stringList(frontmatter.aliases),
    whenToUse: stringValue(frontmatter.when_to_use),
    keywords: stringList(frontmatter.keywords),
    allowImplicitInvocation: frontmatter["allow-implicit-invocation"] !== false,
    userInvocable: frontmatter["user-invocable"] !== false,
    context: frontmatter.context === "fork" ? "fork" : "inline",
    allowedTools: stringList(frontmatter["allowed-tools"]),
    paths: stringList(frontmatter.paths),
    model: stringValue(frontmatter.model),
    effort: stringValue(frontmatter.effort),
  };
}

function normalizeSkillName(value: string): string {
  return value.trim().replace(/_/g, "-");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(isNonEmptyString).map((item) => item.trim());
  const text = stringValue(value);
  return text ? [text] : [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isReadableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function assertFrontmatterBoundary(raw: string): void {
  if (!raw.startsWith("---")) return;
  const lines = raw.split(/\r?\n/);
  const closingIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closingIndex < 0) throw new Error("Invalid SKILL.md frontmatter: missing closing ---");
}

function assertFrontmatterParsed(raw: string, data: object, content: string): void {
  if (raw.startsWith("---") && Object.keys(data).length === 0 && content.trimStart().startsWith("---")) {
    throw new Error("Invalid SKILL.md frontmatter: unable to parse frontmatter");
  }
}

function safeReadDir(root: string): fs.Dirent[] {
  try {
    return fs.statSync(root).isDirectory() ? fs.readdirSync(root, { withFileTypes: true }) : [];
  } catch {
    return [];
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareRecords(left: SkillRecord, right: SkillRecord): number {
  return compareSkills(left.skill, right.skill);
}

function compareSkills(
  left: Pick<SkillInfo, "source" | "name">,
  right: Pick<SkillInfo, "source" | "name">,
): number {
  return sourceRank(left.source) - sourceRank(right.source) || left.name.localeCompare(right.name);
}

function sourceRank(source: SkillSource): number {
  return source === "project" ? 0 : source === "user" ? 1 : 2;
}
