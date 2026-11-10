import { describe, expect, it } from "vitest";
import { NON_DOCUMENT_CLIENT_STATE } from "./constants.js";
import { createDefaultFigureDocument, FULL_CROP } from "./defaults.js";
import { FigureDocumentSchema } from "./document.js";
import { CropNormalizedSchema, CustomLabelTextSchema, HexColorSchema } from "./primitives.js";
import { expectInvalid, expectValid } from "./test-utils.js";

describe("default figure document", () => {
  const document = createDefaultFigureDocument();

  it("matches the handbook defaults", () => {
    expect(document.schemaVersion).toBe(1);
    expect(document.canvas.widthMm).toBe(180);
    expect(document.canvas.heightMm).toBe(120);
    expect(document.canvas.heightMode).toBe("auto");
    expect(document.canvas.background).toBe("#FFFFFF");
    expect(document.canvas.marginsMm).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    expect(document.layoutSettings.gutterMm).toEqual({ horizontal: 4, vertical: 4 });
    expect(document.layoutSettings.preferredHeightMm).toBe(120);
    expect(document.layoutSettings.maxAutoHeightMm).toBe(240);
    expect(document.layoutSettings.minPanelSizeMm).toEqual({ width: 15, height: 10 });
    expect(document.layoutSettings.targetRasterPpi).toBe(300);
    expect(document.layoutSettings.primaryPanelId).toBeNull();
    expect(document.layoutSettings.constraints).toEqual([]);
    expect(document.labelStyle).toEqual({
      fontId: "noto-sans",
      fontSizePt: 9,
      fontWeight: 700,
      color: "#000000",
      visible: true,
      sequence: "upper-alpha",
      format: "plain",
      placement: "outside-top-left",
      gapMm: 1,
    });
    expect(document.panels).toEqual({});
    expect(document.panelOrder).toEqual([]);
    expect(document.stackOrder).toEqual([]);
    expect(document.groups).toEqual({});
  });

  it("validates and does not share nested objects between calls", () => {
    expectValid(FigureDocumentSchema, document);
    const next = createDefaultFigureDocument();
    next.canvas.widthMm = 85;
    expect(document.canvas.widthMm).toBe(180);
  });

  it("rejects unknown fields, lowercase background, and empty label text", () => {
    expectInvalid(FigureDocumentSchema, { ...document, theme: "dark" });
    expectInvalid(FigureDocumentSchema, {
      ...document,
      canvas: { ...document.canvas, background: "#ffffff" },
    });
    expectInvalid(CustomLabelTextSchema, "");
    expectInvalid(CustomLabelTextSchema, "A\nB");
    expectInvalid(CustomLabelTextSchema, "ABCDEFGHIJKLMNOPQ");
    expectValid(CustomLabelTextSchema, "你好世界");
  });

  it("keeps client state and pixel fields out of the document schema", () => {
    const names: string[] = [];
    walk(FigureDocumentSchema, names);
    for (const forbidden of NON_DOCUMENT_CLIENT_STATE) {
      expect(names).not.toContain(forbidden);
    }
    expect(names.some((name) => name.toLowerCase().includes("px"))).toBe(false);
    expect(names).not.toContain("groupId");
    expect(names).not.toContain("secret");
  });

  it("rejects a panel map key that is not a UUID", () => {
    expectInvalid(FigureDocumentSchema, {
      ...document,
      panels: { A: { assetId: "11111111-1111-4111-8111-111111111111" } },
      panelOrder: ["A"],
      stackOrder: ["A"],
    });
  });

  it("accepts a full crop and does not encode the cross-field crop bound", () => {
    expectValid(CropNormalizedSchema, FULL_CROP);
    expectInvalid(CropNormalizedSchema, { x: 0, y: 0, width: 0, height: 1 });
    expectValid(CropNormalizedSchema, { x: 0.8, y: 0, width: 0.5, height: 1 });
  });

  it("accepts six-digit document colors only", () => {
    expectValid(HexColorSchema, "#000000");
    expectValid(HexColorSchema, "#abcdef");
    expectInvalid(HexColorSchema, "#fff");
    expectInvalid(HexColorSchema, "#00000000");
  });
});

function walk(schema: unknown, names: string[]): void {
  if (!schema || typeof schema !== "object") return;
  const record = schema as {
    properties?: Record<string, unknown>;
    anyOf?: unknown[];
    patternProperties?: Record<string, unknown>;
  };
  if (record.properties) {
    for (const [key, value] of Object.entries(record.properties)) {
      names.push(key);
      walk(value, names);
    }
  }
  for (const item of record.anyOf ?? []) walk(item, names);
  for (const value of Object.values(record.patternProperties ?? {})) walk(value, names);
}
