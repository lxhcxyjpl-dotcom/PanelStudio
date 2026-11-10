import type { Font } from "fontkit";
import { BUNDLED_FONTS } from "@panelstudio/contracts";
import { parseFace, type FaceFile } from "./faces.js";

const faces = new Map<string, Font>();
let loading: Promise<void> | undefined;

export function loadFace(file: FaceFile): Font {
  const face = faces.get(file.sha256);
  if (!face) throw new Error(`Bundled face ${file.filename} has not been loaded.`);
  return face;
}

export function initializeLabelFonts(): Promise<void> {
  return loading ??= Promise.all(BUNDLED_FONTS.flatMap((family) => family.weights.map(async (weight) => {
    const file = family.files[weight];
    const url = `/fonts/${file.filename}?v=${file.sha256}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Font download failed (${response.status}).`);
    const buffer = await response.arrayBuffer();
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const actual = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      if (actual !== file.sha256) throw new Error(`Bundled face ${file.filename} does not match the font registry.`);
    }
    const displayFace = new FontFace(family.family, buffer, { weight: String(weight) });
    document.fonts.add(await displayFace.load());
    faces.set(file.sha256, parseFace(new Uint8Array(buffer)));
  }))).then(() => undefined);
}
