import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Font } from "fontkit";
import { parseFace, type FaceFile } from "./faces.js";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fonts");
const faces = new Map<string, Font>();

export function loadFace(file: FaceFile): Font {
  const cached = faces.get(file.sha256);
  if (cached) return cached;
  const bytes = readFileSync(path.join(directory, file.filename));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new Error(`Bundled face ${file.filename} does not match the font registry.`);
  }
  const parsed = parseFace(bytes);
  faces.set(file.sha256, parsed);
  return parsed;
}

// On the server fonts are loaded lazily on the first measurement of each face.
export function initializeLabelFonts(): Promise<void> {
  return Promise.resolve();
}
