export type SkillSource = "project" | "user" | "bundled";

export type SkillContextMode = "inline" | "fork";

export interface SkillFrontmatter {
  name?: string;
  display_name?: string;
  description?: string;
  aliases?: string[] | string;
  when_to_use?: string;
  keywords?: string[] | string;
  "allowed-tools"?: string[] | string;
  context?: SkillContextMode;
  "allow-implicit-invocation"?: boolean;
  "user-invocable"?: boolean;
  paths?: string[] | string;
  model?: string;
  effort?: string;
}

export interface SkillInfo {
  name: string;
  displayName?: string;
  description: string;
  aliases: string[];
  whenToUse?: string;
  keywords: string[];
  source: SkillSource;
  path: string;
  loaded?: boolean;
  allowImplicitInvocation: boolean;
  userInvocable: boolean;
  context: SkillContextMode;
  allowedTools: string[];
  paths: string[];
  model?: string;
  effort?: string;
  content: string;
  rawContent?: string;
  skillFilePath?: string;
}

export interface InvalidSkillInfo {
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  skillFilePath?: string;
  error?: string;
  invalid: true;
}

export type SkillRecord =
  | { status: "valid"; skill: SkillInfo }
  | { status: "invalid"; skill: InvalidSkillInfo };

export interface SkillRegistry {
  records(): SkillRecord[];
  validSkills(): SkillInfo[];
  find(name: string): SkillInfo | undefined;
  search(query: string, limit?: number): SkillSearchResult[];
}

export interface SkillSearchResult {
  skill: SkillInfo;
  score: number;
}

export interface SkillSessionState {
  loadedSkillNames: Set<string>;
  suggestedSkillNames: Set<string>;
  lastCandidates: SkillSearchResult[];
  manualSkillArgs: Map<string, string>;
}

export interface SkillSessionSnapshot {
  loadedSkillNames: string[];
  suggestedSkillNames: string[];
  lastCandidates: SkillSearchResult[];
  manualSkillArgs: Array<[string, string]>;
}
