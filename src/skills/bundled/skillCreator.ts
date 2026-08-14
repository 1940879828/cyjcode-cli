export const skillCreatorSkill = `---
name: skill-creator
display_name: Skill 创建器
description: >-
  Create, update, validate, and improve agent skills. Use this skill whenever
  the user wants to create a skill, write SKILL.md, optimize triggering,
  convert a workflow into a reusable skill, or debug why a skill does not load.
aliases:
  - 创建 skill
  - 写 SKILL.md
  - skill creator
  - skill 生成
keywords:
  - eval
  - benchmark
  - trigger
  - frontmatter
context: inline
---

# Skill Creator

Use this skill to help users create or improve reusable skills.

## Workflow

1. Capture the intent: what the skill should do, when it should trigger, the expected output, and whether test prompts are useful.
2. Draft or revise \`SKILL.md\` with clear frontmatter and direct instructions.
3. Keep trigger guidance in \`description\`, \`aliases\`, \`when_to_use\`, and \`keywords\`.
4. Keep the body focused; move long docs to \`references/\`, reusable scripts to \`scripts/\`, and examples to \`evals/\`.
5. Generate 2-3 realistic eval prompts that represent how users would actually ask for this workflow.
6. Validate frontmatter before treating the skill as complete.
7. Improve the description if the skill under-triggers or over-triggers.

## Frontmatter Defaults

Use a stable kebab-case English \`name\`. Put Chinese or local phrases in
\`display_name\`, \`aliases\`, and \`keywords\`.

Prefer \`description: >-\` for long mixed Chinese/English descriptions or text
containing colons. Keep descriptions under 1024 characters.

## Validation Checklist

- \`SKILL.md\` exists in a dedicated skill directory.
- \`name\` is stable and machine friendly.
- \`description\` explains both what the skill does and when to use it.
- Chinese and English trigger phrases are represented in aliases or keywords.
- Referenced resource files exist.
- The skill does not contain surprising, unsafe, or misleading behavior.

## Current Implementation Boundary

This tigacode-cli version supports lightweight skill creation, validation, and
manual eval prompt drafting. Subagent benchmarks, browser eval viewers, and
packaging are future extensions rather than required steps.
`;
