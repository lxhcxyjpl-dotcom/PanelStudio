import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";

const AAD = Buffer.from("panelstudio.ai-provider.secret.v1");
const keys = new Map<string, Buffer>();

export function masterKey(dataDir: string): Buffer {
  const cached = keys.get(dataDir);
  if (cached) return cached;
  const file = path.join(dataDir, "master.key");
  const key = existsSync(file) ? readFileSync(file) : randomBytes(32);
  if (key.byteLength !== 32) {
    throw new Error("The provider master key could not be read.");
  }
  if (!existsSync(file)) writeFileSync(file, key, { mode: 0o600 });
  chmodSync(file, 0o600);
  keys.set(dataDir, key);
  return key;
}

export function encryptSecret(key: Buffer, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(key: Buffer, stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error("The stored secret could not be read.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]);
  return plain.toString("utf8");
}
