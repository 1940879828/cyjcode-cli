import assert from "node:assert/strict";
import test from "node:test";
import { searchSkills } from "../src/skills/index.js";
import type { SkillInfo } from "../src/skills/index.js";

test("Chinese schema-change phrases match db migration skill", () => {
  const results = searchSkills("帮我给 users 表改表，加一个状态字段，注意数据库变更回滚", [dbMigrationSkill()]);

  assert.equal(results[0]?.skill.name, "db-migration");
  assert.ok((results[0]?.score ?? 0) >= 0.75);
});

test("English schema-change phrases match db migration skill", () => {
  const results = searchSkills("create a schema change migration with rollback", [dbMigrationSkill()]);

  assert.equal(results[0]?.skill.name, "db-migration");
  assert.ok((results[0]?.score ?? 0) >= 0.75);
});

test("near misses remain below auto-injection threshold", () => {
  const results = searchSkills("帮我写一个登录页面，不涉及数据库和迁移", [dbMigrationSkill()]);

  assert.ok((results[0]?.score ?? 0) < 0.75);
});

function dbMigrationSkill(): SkillInfo {
  return {
    name: "db-migration",
    displayName: "数据库迁移",
    description: "Create and review database migrations",
    aliases: ["改表", "数据库变更", "schema change", "migration"],
    whenToUse: "用户需要新增字段、修改表结构、生成 rollback 或检查 migration 安全性时使用。",
    keywords: ["SQL", "Prisma", "Alembic", "表结构", "回滚"],
    source: "project",
    path: "./.agents/skills/db-migration/SKILL.md",
    allowImplicitInvocation: true,
    userInvocable: true,
    context: "inline",
    allowedTools: [],
    paths: [],
    content: "# DB Migration",
  };
}
