import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_FONTS } from "@panelstudio/contracts";
import { strToU8, zipSync } from "fflate";

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fonts");

const FILES = [
  { file: "NotoSans-Regular.ttf", family: "Noto Sans", weight: 400 as const },
  { file: "NotoSans-Bold.ttf", family: "Noto Sans", weight: 700 as const },
  { file: "NotoSansSC-Regular.ttf", family: "Noto Sans SC", weight: 400 as const },
  { file: "NotoSansSC-Bold.ttf", family: "Noto Sans SC", weight: 700 as const },
] as const;

const LICENSES = ["OFL-NotoSans.txt", "OFL-NotoSansSC.txt", "README.md"] as const;

const bundledFamilies = new Set<string>(BUNDLED_FONTS.map((font) => font.family));

const coverage = new Map<string, Array<[number, number]>>();
for (const entry of FILES) {
  coverage.set(coverageKey(entry.family, entry.weight), unicodeRanges(readFileSync(path.join(fontsDir, entry.file))));
}

export function isBundledFamily(family: string): boolean {
  return bundledFamilies.has(family);
}

export function resvgFontOptions(): {
  loadSystemFonts: false;
  fontFiles: string[];
  defaultFontFamily: string;
  sansSerifFamily: string;
} {
  return {
    loadSystemFonts: false,
    fontFiles: FILES.map((entry) => path.join(fontsDir, entry.file)),
    defaultFontFamily: "Noto Sans",
    sansSerifFamily: "Noto Sans",
  };
}

export function fontList(): {
  fonts: Array<{ fontId: "noto-sans" | "noto-sans-sc"; family: string; weights: Array<400 | 700>; bundled: boolean }>;
} {
  return {
    fonts: BUNDLED_FONTS.map((font) => ({
      fontId: font.fontId,
      family: font.family,
      weights: [...font.weights],
      bundled: true,
    })),
  };
}

/** Zip of the font files and the OFL texts. Cached because the bytes do not change at runtime. */
export function fontBundle(): { bytes: Buffer; mediaType: string; filename: string } {
  return { bytes: bundleBytes, mediaType: "application/zip", filename: "panelstudio-fonts.zip" };
}

/** Files copied into a project package when includeBundledFonts is true. */
export function packagedFontFiles(): Array<{ path: string; bytes: Buffer; mediaType: string }> {
  const files: Array<{ path: string; bytes: Buffer; mediaType: string }> = [];
  for (const entry of FILES) {
    files.push({
      path: `fonts/bundled/${entry.file}`,
      bytes: readFileSync(path.join(fontsDir, entry.file)),
      mediaType: "font/ttf",
    });
  }
  for (const name of LICENSES) {
    files.push({
      path: `fonts/licenses/${name}`,
      bytes: readFileSync(path.join(fontsDir, name)),
      mediaType: "text/plain",
    });
  }
  return files;
}

/**
 * Characters in a new label that the bundled face does not cover.
 * An unknown family returns an empty list; the caller records that family as not installed.
 */
export function missingGlyphs(family: string, weight: 400 | 700, text: string): string[] {
  const ranges = coverage.get(coverageKey(family, weight));
  if (!ranges) return [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined || code < 32 || seen.has(char)) continue;
    if (!covers(ranges, code)) {
      seen.add(char);
      missing.push(char);
    }
  }
  return missing;
}

const bundleBytes = buildBundle();

function buildBundle(): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const entry of FILES) {
    entries[entry.file] = readFileSync(path.join(fontsDir, entry.file));
  }
  for (const name of LICENSES) {
    entries[name] = readFileSync(path.join(fontsDir, name));
  }
  entries["README.txt"] = strToU8(
    "PanelStudio bundled fonts. See README.md. Editable SVG uses the family names and does not outline text.\n",
  );
  return Buffer.from(zipSync(entries, { level: 6 }));
}

function coverageKey(family: string, weight: 400 | 700): string {
  return `${family}\n${weight}`;
}

function covers(ranges: Array<[number, number]>, code: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = ranges[mid];
    if (!range) return false;
    if (code < range[0]) high = mid - 1;
    else if (code > range[1]) low = mid + 1;
    else return true;
  }
  return false;
}

function unicodeRanges(bytes: Buffer): Array<[number, number]> {
  const cmap = tableOffset(bytes, "cmap");
  const tables = bytes.readUInt16BE(cmap + 2);
  const ranges: Array<[number, number]> = [];
  for (let index = 0; index < tables; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = bytes.readUInt16BE(record);
    const encoding = bytes.readUInt16BE(record + 2);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const subtable = cmap + bytes.readUInt32BE(record + 4);
    const format = bytes.readUInt16BE(subtable);
    if (format === 4) readFormat4(bytes, subtable, ranges);
    else if (format === 12) readFormat12(bytes, subtable, ranges);
  }
  const merged = mergeRanges(ranges);
  if (merged.length === 0) throw new Error("A bundled font has no Unicode cmap.");
  return merged;
}

function readFormat4(bytes: Buffer, offset: number, into: Array<[number, number]>): void {
  const segCount = bytes.readUInt16BE(offset + 6) / 2;
  const endBase = offset + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  for (let index = 0; index < segCount; index += 1) {
    const end = bytes.readUInt16BE(endBase + index * 2);
    const start = bytes.readUInt16BE(startBase + index * 2);
    if (start === 0xffff) continue;
    const delta = bytes.readInt16BE(deltaBase + index * 2);
    const idRangeOffset = bytes.readUInt16BE(rangeBase + index * 2);
    let runStart: number | null = null;
    let previous = -1;
    for (let code = start; code <= end; code += 1) {
      let glyph = 0;
      if (idRangeOffset === 0) glyph = (code + delta) & 0xffff;
      else {
        const glyphOffset = rangeBase + index * 2 + idRangeOffset + (code - start) * 2;
        if (glyphOffset + 1 < bytes.length) {
          const raw = bytes.readUInt16BE(glyphOffset);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
      }
      if (glyph !== 0 && code >= 32) {
        if (runStart === null) {
          runStart = code;
          previous = code;
        } else if (code === previous + 1) previous = code;
        else {
          into.push([runStart, previous]);
          runStart = code;
          previous = code;
        }
      } else if (runStart !== null) {
        into.push([runStart, previous]);
        runStart = null;
      }
    }
    if (runStart !== null) into.push([runStart, previous]);
  }
}

function readFormat12(bytes: Buffer, offset: number, into: Array<[number, number]>): void {
  const groups = bytes.readUInt32BE(offset + 12);
  let cursor = offset + 16;
  for (let index = 0; index < groups; index += 1) {
    const start = bytes.readUInt32BE(cursor);
    const end = bytes.readUInt32BE(cursor + 4);
    const glyph = bytes.readUInt32BE(cursor + 8);
    cursor += 12;
    let from = glyph === 0 ? start + 1 : start;
    if (from < 32) from = 32;
    if (from <= end) into.push([from, end]);
  }
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.filter((range) => range[0] <= range[1]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (!last || range[0] > last[1] + 1) merged.push([range[0], range[1]]);
    else if (range[1] > last[1]) last[1] = range[1];
  }
  return merged;
}

function tableOffset(bytes: Buffer, tag: string): number {
  const count = bytes.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    if (bytes.toString("latin1", record, record + 4) === tag) return bytes.readUInt32BE(record + 8);
  }
  throw new Error(`Font table ${tag} is missing.`);
}
