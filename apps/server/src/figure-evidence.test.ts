import { describe, expect, it } from "vitest";
import {
  FigureOcr,
  extractFigureEvidence,
  differentKinds,
  printedGroupConflict,
  readingImage,
} from "./figure-evidence.js";

describe("figure evidence from visible marks", () => {
  const source = (body: string) => ({
    width: 840,
    height: 300,
    mediaType: "image/svg+xml",
    bytes: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="840" height="300"><rect width="840" height="300" fill="white"/>' +
        body +
        "</svg>",
    ),
  });
  it("reads vector text in drawing order without exposing definitions or hidden labels", async () => {
    const ocr = new FigureOcr();
    try {
      const r = await extractFigureEvidence(
        source(
          '<defs><text>Hidden test subject</text></defs><g display="none"><text>Hidden sample</text></g><text x="25" y="60"><tspan>Dose</tspan> (mg/day)<tspan visibility="hidden">noise</tspan></text><polyline points="30,80 250,110 700,60"/><circle cx="30" cy="80" r="4"/><circle cx="250" cy="110" r="4"/>',
        ),
        ocr,
      );
      expect(r).toMatchObject({
        category: "line",
        confidence: "high",
        svgText: ["Dose (mg/day)"],
        ocrStatus: "not-needed",
      });
    } finally {
      await ocr.close();
    }
  });
  it("uses the installed Chinese and English OCR data on real pixels", async () => {
    const svg = source(
      '<g font-family="Noto Sans SC" font-size="52" fill="black"><text x="50" y="102">处理组</text><text x="50" y="218">Dose response</text></g>',
    );
    const png = await readingImage(svg, 840),
      ocr = new FigureOcr();
    try {
      const r = await extractFigureEvidence({ ...svg, mediaType: "image/png", bytes: png }, ocr);
      expect(r.svgText).toEqual([]);
      expect(r.ocrStatus).toBe("read");
      expect(r.ocrText.join("").replace(/\s/g, "")).toContain("处理组");
      expect(r.ocrText.join(" ")).toMatch(/Dose response/i);
    } finally {
      await ocr.close();
    }
  }, 30000);
  it("only interrupts on a mutually exclusive printed group", () => {
    expect(printedGroupConflict("Control-line.svg", ["Dose", "Treated only"])).toEqual({
      nameQuote: "Control",
      imageQuote: "Treated only",
    });
    expect(printedGroupConflict("Control-line.svg", ["Treated only", "Control"])).toBeNull();
    expect(printedGroupConflict("IMG_001.png", ["仅处理组"])).toBeNull();
    expect(printedGroupConflict("对照组-图二.png", ["仅处理组"])).toEqual({
      nameQuote: "对照组",
      imageQuote: "仅处理组",
    });
  });
  it("asks about incompatible types and tolerates subtype descriptions", () => {
    expect(differentKinds("heatmap", "line")).toBe(true);
    expect(differentKinds("box", "bar")).toBe(true);
    expect(differentKinds("embedding", "scatter")).toBe(false);
    expect(differentKinds("unknown", "scatter")).toBe(false);
  });
});
