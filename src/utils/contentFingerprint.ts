import crypto from "node:crypto";

export function contentFingerprint(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}
