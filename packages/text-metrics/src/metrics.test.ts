import { describe, expect, it } from "vitest";
import { BUNDLED_FONTS } from "@panelstudio/contracts";
import { measureLabel, type LabelMeasureInput } from "./index.js";

function measured(text: string, options: Partial<LabelMeasureInput> = {}) {
  const result = measureLabel({ fontId: "noto-sans", fontWeight: 400, fontSizePt: 9, text, ...options });
  if (result.status !== "measured") throw Error(result.reason);
  return result;
}

describe("registered glyph outlines", () => {
  it("distinguishes real advance, ink, kerning and negative bearings", () => {
    const narrow = measured("III");
    const wide = measured("WWW");
    expect(narrow.advanceMm).toBeLessThan(wide.advanceMm / 2);
    expect(narrow.inkBoundsMm!.width).toBeLessThan(wide.inkBoundsMm!.width / 2);
    expect(measured("AV").advanceMm).toBeLessThan(measured("A").advanceMm + measured("V").advanceMm);
    expect(measured("j").inkBoundsMm!.x).toBeLessThan(0);
    expect(measured("A ").inkBoundsMm).toEqual(measured("A").inkBoundsMm);
    expect(measured("A ").advanceMm).toBeGreaterThan(measured("A").advanceMm);
    expect(measured("  ").inkBoundsMm).toBe(null);
    expect(measured("  ").advanceMm).toBeGreaterThan(0);
  });
  it("reads both weights of both checked-in files and converts font units to mm", () => {
    for (const family of BUNDLED_FONTS) {
      for (const weight of family.weights) {
        const style = { fontId: family.fontId, fontWeight: weight };
        const sample = family.fontId === "noto-sans-sc" ? "图(Aβ)二" : "(Aβ)fj";
        const label = measured(sample, style);
        expect(label.fontFingerprint).toBe(family.files[weight].sha256);
        expect(label.metricsVersion).toContain(label.fontFingerprint);
        expect(measured(sample, { ...style, fontSizePt: 18 }).inkBoundsMm!.height).toBeCloseTo(2 * label.inkBoundsMm!.height, 10);
      }
    }
    expect(measured("A", {fontWeight: 700}).inkBoundsMm).not.toEqual(measured("A").inkBoundsMm);
  });
  it("reports missing characters and unsupported controls without a fallback face", () => {
    expect(measureLabel({fontId:"noto-sans", fontWeight:400, fontSizePt:9, text:"图图"})).toEqual({
      status:"unavailable", reason:"missing-glyph", characters:["图"],
    });
    expect(measureLabel({fontId:"noto-sans-sc", fontWeight:700, fontSizePt:9, text:"A\u200dB"})).toEqual({
      status:"unavailable", reason:"unsupported-text-layout",
    });
  });
});
