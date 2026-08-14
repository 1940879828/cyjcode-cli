import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkillRegistry, findSkill, formatSkillsForDisplay, loadSkills } from "../src/skills/index.js";

test("loads skill directories, parses multilingual metadata, and skips invalid entries", () => {
  const workspace = createWorkspace();
  writeSkill(workspace, ".tigacode/skills/db-migration", {
    frontmatter: [
      "name: db-migration",
      "display_name: 数据库迁移",
      "description: Create database migrations",
      "aliases: [改表, 数据库变更]",
      "keywords: [schema change, rollback]",
      "when_to_use: 用户需要修改表结构时使用",
    ],
    body: "# DB Migration",
  });
  fs.mkdirSync(path.join(workspace, ".tigacode", "skills", "empty"), { recursive: true });

  const skill = loadSkills(workspace).find((item) => item.name === "db-migration");

  assert.equal(skill?.displayName, "数据库迁移");
  assert.deepEqual(skill?.aliases, ["改表", "数据库变更"]);
  assert.deepEqual(skill?.keywords, ["schema change", "rollback"]);
  assert.equal(skill?.whenToUse, "用户需要修改表结构时使用");
  assert.equal(loadSkills(workspace).some((item) => item.name === "empty"), false);
});

test("higher-priority project native skills override same-name project agent skills", () => {
  const workspace = createWorkspace();
  writeSkill(workspace, ".agents/skills/shared", {
    frontmatter: ["name: shared", "description: Lower priority"],
    body: "# Lower",
  });
  writeSkill(workspace, ".tigacode/skills/shared", {
    frontmatter: ["name: shared", "description: Higher priority"],
    body: "# Higher",
  });

  const skill = loadSkills(workspace).find((item) => item.name === "shared");

  assert.equal(skill?.description, "Higher priority");
  assert.equal(skill?.path, "./.tigacode/skills/shared/SKILL.md");
});

test("bundled skill-creator is available at lowest priority", () => {
  const workspace = createWorkspace();
  const skill = loadSkills(workspace).find((item) => item.name === "skill-creator");

  assert.equal(skill?.source, "bundled");
  assert.match(skill?.description ?? "", /Create, update, validate/);
});

test("invalid frontmatter is reported without breaking skill loading", () => {
  const workspace = createWorkspace();
  writeRawSkill(workspace, ".agents/skills/bad-skill", "---\nname: bad\naliases: [\n---\n# Bad\n");

  const skills = loadSkills(workspace);
  const records = createSkillRegistry(workspace).records();
  const invalid = records.find((item) => item.skill.name === "bad-skill");

  assert.equal(invalid?.status, "invalid");
  assert.match(invalid?.skill.error ?? "", /Invalid SKILL\.md frontmatter|unexpected end/i);
  assert.match(formatSkillsForDisplay(records.map((item) => item.skill)), /\[project, invalid\]/);
  assert.equal(skills.some((item) => item.name === "bad-skill"), false);
});

test("non-directory skill roots are ignored", () => {
  const workspace = createWorkspace();
  fs.mkdirSync(path.join(workspace, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(workspace, ".agents", "skills"), "not a directory", "utf8");

  const skills = loadSkills(workspace);

  assert.equal(skills.some((item) => item.path.startsWith("./.agents/skills")), false);
});

test("invalid higher-priority skills block lower-priority skills with the same name", () => {
  const workspace = createWorkspace();
  writeRawSkill(workspace, ".tigacode/skills/shared", "---\nname: shared\naliases: [\n---\n# Bad\n");
  writeSkill(workspace, ".agents/skills/shared", {
    frontmatter: ["name: shared", "description: Lower valid"],
    body: "# Lower Valid",
  });

  const shared = createSkillRegistry(workspace).records().find((item) => item.skill.name === "shared");

  assert.equal(shared?.status, "invalid");
  assert.equal(shared?.skill.path, "./.tigacode/skills/shared/SKILL.md");
  assert.equal(findSkill("shared", workspace), undefined);
});

test("valid skill bodies may start with a markdown rule", () => {
  const workspace = createWorkspace();
  writeRawSkill(workspace, ".agents/skills/hr-body", "---\nname: hr-body\ndescription: Valid\n---\n---\n# Body\n");

  const skill = loadSkills(workspace).find((item) => item.name === "hr-body");

  assert.match(skill?.content ?? "", /^---\n# Body/);
});

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tigacode-skills-loader-"));
}

function writeSkill(
  workspace: string,
  relativeDir: string,
  input: { frontmatter: string[]; body: string },
): void {
  const skillDir = path.join(workspace, relativeDir);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), renderSkill(input), "utf8");
}

function writeRawSkill(workspace: string, relativeDir: string, content: string): void {
  const skillDir = path.join(workspace, relativeDir);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
}

function renderSkill(input: { frontmatter: string[]; body: string }): string {
  return `---\n${input.frontmatter.join("\n")}\n---\n\n${input.body}\n`;
}
