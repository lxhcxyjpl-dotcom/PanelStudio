import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export class BlobStore {
  constructor(private readonly root: string) {
    mkdirSync(path.join(root, "blobs"), { recursive: true });
  }

  put(bytes: Buffer): { sha256: string; relativePath: string } {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const relativePath = path.posix.join("blobs", digest.slice(0, 2), digest);
    const absolute = this.resolve(relativePath);
    if (!existsSync(absolute)) {
      mkdirSync(path.dirname(absolute), { recursive: true });
      const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporary, bytes);
      const written = createHash("sha256").update(readFileSync(temporary)).digest("hex");
      if (written !== digest) {
        rmSync(temporary, { force: true });
        throw new Error("blob hash mismatch");
      }
      if (existsSync(absolute)) rmSync(temporary, { force: true });
      else renameSync(temporary, absolute);
    }
    return { sha256: digest, relativePath };
  }

  read(relativePath: string): Buffer {
    return readFileSync(this.resolve(relativePath));
  }

  private resolve(relativePath: string): string {
    if (!relativePath || relativePath.includes("\\") || relativePath.includes("\0")) {
      throw new Error("unsafe blob path");
    }
    const absolute = path.resolve(this.root, relativePath);
    const root = path.resolve(this.root);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw new Error("unsafe blob path");
    }
    const parts = relativePath.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) {
      throw new Error("unsafe blob path");
    }
    return absolute;
  }
}
