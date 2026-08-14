import { loadSkillRecords } from "./loader.js";
import { searchSkills } from "./search.js";
import type { SkillInfo, SkillRecord, SkillRegistry, SkillSearchResult } from "./types.js";

export function createSkillRegistry(workspaceRoot = process.cwd()): SkillRegistry {
  return {
    records: () => loadSkillRecords(workspaceRoot),
    validSkills: () => validSkills(loadSkillRecords(workspaceRoot)),
    find: (name) => findRecordSkill(loadSkillRecords(workspaceRoot), name),
    search: (query, limit) => searchSkills(query, validSkills(loadSkillRecords(workspaceRoot)), limit),
  };
}

function validSkills(records: SkillRecord[]): SkillInfo[] {
  return records
    .filter((record): record is { status: "valid"; skill: SkillInfo } => record.status === "valid")
    .map((record) => record.skill);
}

function findRecordSkill(records: SkillRecord[], name: string): SkillInfo | undefined {
  const normalized = normalizeSkillName(name);
  const record = records.find((item) => item.skill.name === normalized);
  return record?.status === "valid" ? record.skill : undefined;
}

function normalizeSkillName(value: string): string {
  return value.trim().replace(/^\//, "").replace(/_/g, "-");
}
