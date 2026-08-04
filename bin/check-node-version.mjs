#!/usr/bin/env node

const REQUIRED_MAJOR = 22;

const major = Number(process.versions.node.split(".")[0]);

if (Number.isNaN(major) || major < REQUIRED_MAJOR) {
  console.error(`需要 Node.js ${REQUIRED_MAJOR} 或更高版本，当前：${process.version}`);
  console.error("请升级 Node.js：https://nodejs.org/");
  process.exit(1);
}

await import("../dist/cli.js");
