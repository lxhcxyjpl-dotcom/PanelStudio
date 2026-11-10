import { BUNDLED_FONTS, ENGINE_VERSIONS, fontSizePtToSvgUserUnits, type LabelTypography } from "@panelstudio/contracts";
import { loadFace } from "#font-source";

export { initializeLabelFonts } from "#font-source";

export type LabelMeasureInput = Pick<LabelTypography, "fontId" | "fontWeight" | "fontSizePt"> & { text: string };
export type InkBoundsMm = { x: number; y: number; width: number; height: number };
export type LabelMeasureResult =
  | { status: "measured"; advanceMm: number; inkBoundsMm: InkBoundsMm | null; fontFingerprint: string; metricsVersion: string }
  | { status: "unavailable"; reason: "missing-glyph" | "unsupported-text-layout"; characters?: string[] };

const cache = new Map<string, LabelMeasureResult>();
const cacheLimit = 2048;

export function measureLabel(input: LabelMeasureInput): LabelMeasureResult {
  const family = BUNDLED_FONTS.find((item) => item.fontId === input.fontId);
  if (!family || !(input.fontSizePt > 0) || !Number.isFinite(input.fontSizePt)) {
    return { status: "unavailable", reason: "unsupported-text-layout" };
  }
  const file = family.files[input.fontWeight];
  const key = JSON.stringify([ENGINE_VERSIONS.fontRegistry, file.sha256, input.fontSizePt, input.text]);
  const previous = cache.get(key);
  if (previous) return previous;
  // Control/format characters require whitespace or bidi processing outside the single-line label model.
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(input.text)) return { status: "unavailable", reason: "unsupported-text-layout" };
  const font = loadFace(file);
  const missing = [...new Set(input.text)].filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)!));
  let result: LabelMeasureResult;
  if (missing.length) {
    result = { status: "unavailable", reason: "missing-glyph", characters: missing };
  } else {
    const run = font.layout(input.text);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let penX = 0, penY = 0;
    for (let i = 0; i < run.glyphs.length; i++) {
      const glyph = run.glyphs[i]!;
      const pos = run.positions[i]!;
      const box = glyph.bbox;
      if (box.maxX > box.minX && box.maxY > box.minY) {
        minX = Math.min(minX, penX + pos.xOffset + box.minX);
        maxX = Math.max(maxX, penX + pos.xOffset + box.maxX);
        minY = Math.min(minY, penY + pos.yOffset + box.minY);
        maxY = Math.max(maxY, penY + pos.yOffset + box.maxY);
      }
      penX += pos.xAdvance;
      penY += pos.yAdvance;
    }
    const mm = fontSizePtToSvgUserUnits(input.fontSizePt) / font.unitsPerEm;
    result = {
      status: "measured",
      advanceMm: penX * mm,
      inkBoundsMm: Number.isFinite(minX)
        ? { x: minX * mm, y: -maxY * mm, width: (maxX - minX) * mm, height: (maxY - minY) * mm }
        : null,
      metricsVersion: ENGINE_VERSIONS.fontRegistry,
      fontFingerprint: file.sha256,
    };
  }
  if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
