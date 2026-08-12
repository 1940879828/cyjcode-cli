import fs from "node:fs";

interface PackageMetadata {
  version?: string;
}

let cachedVersion: string | null = null;

export function getPackageVersion(): string {
  if (cachedVersion !== null) return cachedVersion;

  const metadata = readPackageMetadata();
  cachedVersion = metadata?.version ?? "0.0.0";
  return cachedVersion;
}

function readPackageMetadata(): PackageMetadata | null {
  for (const packageUrl of packageUrls()) {
    try {
      return JSON.parse(fs.readFileSync(packageUrl, "utf-8")) as PackageMetadata;
    } catch {
      continue;
    }
  }
  return null;
}

function packageUrls(): URL[] {
  return [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];
}
