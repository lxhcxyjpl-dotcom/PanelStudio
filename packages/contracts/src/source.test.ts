import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("single document model", () => {
  it("defines TypeBox schemas only in contracts", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, "packages")).concat(sourceFiles(join(root, "apps")))) {
      if (file.includes(`${join("packages", "contracts")}`)) continue;
      const text = readFileSync(file, "utf8");
      if (
        /from\s+["']typebox["']/.test(text) ||
        /schemaVersion\s*:\s*1\b/.test(text) ||
        /FigureDocumentSchema/.test(text) ||
        /type\s+FigureDocument\b/.test(text)
      ) {
        offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) found.push(...sourceFiles(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}
