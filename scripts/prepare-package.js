import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = [
  "package.json",
  "README.md",
  "bin/check-node-version.mjs",
  "dist/cli.js",
];

const EXCLUDED_PREFIXES = [
  "src/",
  "tests/",
  "docs/",
  ".babel-out/",
  "mockdata/",
];

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf-8",
    shell: false,
    stdio: options.stdio ?? "inherit",
  });
  if (result.status !== 0) {
    fail(result.error?.message ?? `Command failed: ${command} ${args.join(" ")}`);
  }
  return result;
}

function runNpm(args, options) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && existsSync(npmExecPath)) return run(process.execPath, [npmExecPath, ...args], options);
  if (process.platform === "win32") return runPowerShellNpm(args, options);
  return run("npm", args, options);
}

function runPowerShellNpm(args, options) {
  const command = `& ${["npm", ...args].map(quotePowerShellArg).join(" ")}`;
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], options);
}

function quotePowerShellArg(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function validatePackageJson() {
  const packageJson = readJson(join(rootDir, "package.json"));
  const binPath = packageJson.bin?.tigacode;

  if (binPath !== "bin/check-node-version.mjs") fail("package.json bin.tigacode must point to bin/check-node-version.mjs");
  if (packageJson.main !== "./dist/cli.js") fail("package.json main must point to ./dist/cli.js");
  if (!packageJson.files?.includes("dist/")) fail("package.json files must include dist/");
}

function validateBuildArtifacts() {
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(rootDir, file))) fail(`Missing required package file: ${file}`);
  }
}

function readPackFiles() {
  const result = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], {
    stdio: "pipe",
  });
  const pack = JSON.parse(result.stdout.trim())[0];
  return pack.files.map((file) => file.path);
}

function validatePackFiles(files) {
  const missing = REQUIRED_FILES.filter((file) => !files.includes(file));
  const leaked = files.filter((file) => EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)));

  if (missing.length > 0) fail(`Package tarball is missing:\n${missing.map((file) => `- ${file}`).join("\n")}`);
  if (leaked.length > 0) fail(`Package tarball includes development files:\n${leaked.map((file) => `- ${file}`).join("\n")}`);
}

step("Building package artifacts...");
runNpm(["run", "build"]);

step("Validating package metadata...");
validatePackageJson();
validateBuildArtifacts();

step("Validating npm pack contents...");
validatePackFiles(readPackFiles());

console.log("\nPackage is ready for npm publish.");
