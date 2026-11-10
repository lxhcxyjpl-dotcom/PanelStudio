import { createDefaultFigureDocument, type DomainCommand } from "@panelstudio/contracts";
import { describe, expect, it } from "vitest";
import { applyCommands, DocumentCommandError, type ReadyAssetFacts } from "./apply.js";
import { hashFigureDocument } from "./hash.js";
import { resolvePanelLabel } from "./labels.js";

const PANEL = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const ASSET = "22222222-2222-4222-8222-222222222222";

const asset: ReadyAssetFacts = {
  id: ASSET,
  originalFilename: "raster.png",
  viewport: { width: 80, height: 40 },
  rasterPixelSize: { width: 80, height: 40 },
};

function add(panelId: string, frame: { x: number; y: number; width: number; height: number }): DomainCommand {
  return { type: "panel.add", panelId, assetId: ASSET, frameMm: frame };
}

describe("phase 1 commands", () => {
  it("adds a panel with an automatic A label and a stable hash", () => {
    const next = applyCommands(createDefaultFigureDocument(), [add(PANEL, { x: 10, y: 12, width: 40, height: 20 })], () => asset);
    expect(next.panelOrder).toEqual([PANEL]);
    expect(next.stackOrder).toEqual([PANEL]);
    expect(next.panels[PANEL]?.name).toBe("raster.png");
    expect(next.panels[PANEL]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(resolvePanelLabel(next, PANEL)?.text).toBe("A");
    expect(resolvePanelLabel(next, PANEL)?.fontFamily).toBe("Noto Sans");
    expect(hashFigureDocument(next)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashFigureDocument(next)).toBe(hashFigureDocument(structuredClone(next)));
  });

  it("rejects a frame that breaks the cropped aspect ratio", () => {
    expect(() =>
      applyCommands(createDefaultFigureDocument(), [add(PANEL, { x: 10, y: 12, width: 40, height: 40 })], () => asset),
    ).toThrow(DocumentCommandError);
  });

  it("rejects a crop that leaves the unit square", () => {
    try {
      applyCommands(
        createDefaultFigureDocument(),
        [
          {
            type: "panel.add",
            panelId: PANEL,
            assetId: ASSET,
            frameMm: { x: 10, y: 12, width: 20, height: 10 },
            cropNormalized: { x: 0.8, y: 0, width: 0.5, height: 1 },
          },
        ],
        () => asset,
      );
      throw new Error("expected the crop to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentCommandError);
      expect((error as DocumentCommandError).code).toBe("DOCUMENT_INVALID");
    }
  });

  it("rejects a label that sits outside the canvas", () => {
    try {
      applyCommands(createDefaultFigureDocument(), [add(PANEL, { x: 10, y: 0, width: 40, height: 20 })], () => asset);
      throw new Error("expected the label to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentCommandError);
      expect((error as DocumentCommandError).code).toBe("OUTSIDE_CANVAS");
    }
  });

  it("does not apply edit-kernel commands", () => {
    const document = applyCommands(
      createDefaultFigureDocument(),
      [add(PANEL, { x: 10, y: 12, width: 40, height: 20 })],
      () => asset,
    );
    expect(() =>
      applyCommands(
        document,
        [{ type: "panel.setFrames", items: [{ panelId: PANEL, frameMm: { x: 12, y: 12, width: 40, height: 20 } }] }],
        () => asset,
      ),
    ).toThrow(/phase 1/u);
  });

  it("numbers a second panel B without clearing the first", () => {
    const next = applyCommands(
      createDefaultFigureDocument(),
      [
        add(PANEL, { x: 10, y: 12, width: 40, height: 20 }),
        add(OTHER, { x: 60, y: 12, width: 40, height: 20 }),
      ],
      () => asset,
    );
    expect(resolvePanelLabel(next, PANEL)?.text).toBe("A");
    expect(resolvePanelLabel(next, OTHER)?.text).toBe("B");
  });
});
