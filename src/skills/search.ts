import type { SkillInfo, SkillSearchResult } from "./types.js";

const FIELD_WEIGHTS = {
  name: 3,
  aliases: 2.5,
  whenToUse: 2,
  keywords: 1.5,
  description: 1,
} as const;

const MAX_FIELD_WEIGHT = FIELD_WEIGHTS.name;
const DEFAULT_LIMIT = 5;
const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "or",
  "please",
  "the",
  "to",
  "with",
  "create",
]);

export function searchSkills(
  query: string,
  skills: SkillInfo[],
  limit = DEFAULT_LIMIT,
): SkillSearchResult[] {
  const queryTokens = uniqueTokens(query);
  if (queryTokens.length === 0) return [];
  return skills
    .map((skill) => ({ skill, score: scoreSkill(skill, query, queryTokens) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, limit);
}

export function tokenizeSkillText(text: string): string[] {
  const tokens: string[] = [];
  for (const part of splitTextParts(text)) {
    tokens.push(...(isCjkText(part) ? cjkBigrams(part) : englishTokens(part)));
  }
  return tokens;
}

function scoreSkill(skill: SkillInfo, rawQuery: string, queryTokens: string[]): number {
  const tokenWeights = skillTokenWeights(skill);
  const matched = queryTokens.reduce((sum, token) => sum + (tokenWeights.get(token) ?? 0), 0);
  const baseScore = matched / (queryTokens.length * MAX_FIELD_WEIGHT);
  return Math.min(1, baseScore + phraseBoost(skill, rawQuery) + pathBoost(skill, rawQuery));
}

function skillTokenWeights(skill: SkillInfo): Map<string, number> {
  const tokenWeights = new Map<string, number>();
  addWeightedTokens(tokenWeights, [skill.name, skill.displayName].filter(Boolean).join(" "), FIELD_WEIGHTS.name);
  addWeightedTokens(tokenWeights, skill.aliases.join(" "), FIELD_WEIGHTS.aliases);
  addWeightedTokens(tokenWeights, skill.whenToUse ?? "", FIELD_WEIGHTS.whenToUse);
  addWeightedTokens(tokenWeights, skill.keywords.join(" "), FIELD_WEIGHTS.keywords);
  addWeightedTokens(tokenWeights, skill.description, FIELD_WEIGHTS.description);
  return tokenWeights;
}

function addWeightedTokens(tokenWeights: Map<string, number>, text: string, weight: number): void {
  for (const token of uniqueTokens(text)) {
    tokenWeights.set(token, Math.max(tokenWeights.get(token) ?? 0, weight));
  }
}

function uniqueTokens(text: string): string[] {
  return [...new Set(tokenizeSkillText(text))];
}

function splitTextParts(text: string): string[] {
  return text.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
}

function isCjkText(text: string): boolean {
  return /[\p{Script=Han}]/u.test(text);
}

function cjkBigrams(text: string): string[] {
  if (text.length <= 1) return text ? [text] : [];
  return Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2));
}

function englishTokens(text: string): string[] {
  return text
    .split(/[-_]+/)
    .map(stem)
    .filter(isSearchToken);
}

function isSearchToken(token: string): boolean {
  return token.length > 0 && !ENGLISH_STOP_WORDS.has(token);
}

function stem(token: string): string {
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("tion") && token.length > 5) return token.slice(0, -4);
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3 && !token.endsWith("ss")) return token.slice(0, -1);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  return token;
}

function pathBoost(skill: SkillInfo, query: string): number {
  const normalizedQuery = query.replace(/\\/g, "/");
  return skill.paths.some((skillPath) => normalizedQuery.includes(skillPath.replace(/\\/g, "/"))) ? 0.15 : 0;
}

function phraseBoost(skill: SkillInfo, query: string): number {
  const normalizedQuery = query.toLowerCase();
  const phrases = [...skill.aliases, ...skill.keywords].filter((phrase) => phrase.length >= 2);
  const matches = phrases.filter((phrase) => normalizedQuery.includes(phrase.toLowerCase()));
  return Math.min(0.5, matches.length * 0.18);
}
