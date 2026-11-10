import { createHash } from "node:crypto";
import type { FigureDocumentV1 } from "@panelstudio/contracts";

/** Canonical JSON with sorted object keys. Arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return JSON.stringify(value);
  if (kind === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("canonical JSON cannot contain this value");
}

/**
 * Phase 1 document hash: lowercase SHA-256 of canonical JSON.
 * The handbook leaves the algorithm opaque; this is the encoding we store.
 */
export function hashFigureDocument(document: FigureDocumentV1): string {
  return createHash("sha256").update(canonicalJson(document)).digest("hex");
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
