import { createDefaultFigureDocument, NUDGE_MM, type DomainCommand, type FigureDocumentV1 } from "@panelstudio/contracts";
import { describe, expect, it } from "vitest";
import {
  alignSelection,
  distributeSelection,
  equalSizeSelection,
  scalePanel,
  translateSelection,
} from "./arrange.js";
import { applyCommands, DocumentCommandError, type ReadyAssetFacts } from "./apply.js";
import { aspectMatches, contentPlacement, frameAfterCrop, scaleFrame } from "./geometry.js";
import { resolvePanelLabel } from "./labels.js";
import { movedStackOrder, stackOrderCommand } from "./stack.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-111111111112";
const C = "11111111-1111-4111-8111-111111111113";
const WIDE = "22222222-2222-4222-8222-222222222222";
const SQUARE = "22222222-2222-4222-8222-222222222223";
const WIDE_COPY = "22222222-2222-4222-8222-222222222224";
const GROUP = "33333333-3333-4333-8333-333333333333";
const CONSTRAINT = "44444444-4444-4444-8444-444444444444";

const wide: ReadyAssetFacts = {
  id: WIDE,
  originalFilename: "wide.png",
  viewport: { width: 80, height: 40 },
  rasterPixelSize: { width: 80, height: 40 },
};
const square: ReadyAssetFacts = {
  id: SQUARE,
  originalFilename: "square.png",
  viewport: { width: 40, height: 40 },
  rasterPixelSize: { width: 40, height: 40 },
};
const wideCopy: ReadyAssetFacts = {
  id: WIDE_COPY,
  originalFilename: "wide-copy.png",
  viewport: { width: 80, height: 40 },
  rasterPixelSize: { width: 80, height: 40 },
};

function lookup(assetId: string): ReadyAssetFacts | null {
  if (assetId === WIDE) return wide;
  if (assetId === SQUARE) return square;
  if (assetId === WIDE_COPY) return wideCopy;
  return null;
}

function add(panelId: string, assetId: string, frameMm: { x: number; y: number; width: number; height: number }): DomainCommand {
  return { type: "panel.add", panelId, assetId, frameMm };
}

function placed(): FigureDocumentV1 {
  return applyCommands(
    createDefaultFigureDocument(),
    [
      add(A, WIDE, { x: 10, y: 20, width: 40, height: 20 }),
      add(B, WIDE, { x: 60, y: 20, width: 40, height: 20 }),
      add(C, WIDE, { x: 120, y: 20, width: 20, height: 10 }),
    ],
    lookup,
  );
}

function run(document: FigureDocumentV1, commands: DomainCommand[]): FigureDocumentV1 {
  return applyCommands(document, commands, lookup);
}

function panelOf(document: FigureDocumentV1, id: string) {
  const panel = document.panels[id];
  if (!panel) throw new Error(`missing panel ${id}`);
  return panel;
}

function codeOf(runCase: () => void): DocumentCommandError {
  try {
    runCase();
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentCommandError);
    return error as DocumentCommandError;
  }
  throw new Error("expected a command error");
}

describe("phase 2 edit kernel", () => {
  it("scales from the opposite corner and keeps the crop aspect", () => {
    const scaled = scaleFrame({ x: 10, y: 20, width: 40, height: 20 }, { width: 20 }, "bottom-right");
    expect(scaled).toEqual({ x: 30, y: 30, width: 20, height: 10 });
    expect(scaled.x + scaled.width).toBe(50);
    expect(scaled.y + scaled.height).toBe(40);
    const document = run(placed(), [scalePanel(placed(), A, { width: 20 }, "top-left")]);
    const frame = document.panels[A]?.frameMm;
    expect(frame).toEqual({ x: 10, y: 20, width: 20, height: 10 });
    expect(aspectMatches(frame ?? scaled, document.panels[A]?.cropNormalized ?? { x: 0, y: 0, width: 1, height: 1 }, wide.viewport)).toBe(true);
    expect(document.canvas.heightMm).toBe(120);
    expect(document.canvas.heightMode).toBe("auto");
    expect(document.panelOrder).toEqual([A, B, C]);
  });

  it("keeps source content fixed when the crop changes and rejects a crop outside the unit square", () => {
    const document = placed();
    const before = contentPlacement(panelOf(document, A).frameMm, panelOf(document, A).cropNormalized, wide.viewport);
    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const next = run(document, [{ type: "panel.setCrop", panelId: A, cropNormalized: crop }]);
    expect(panelOf(next, A).frameMm).toEqual(
      frameAfterCrop(panelOf(document, A).frameMm, panelOf(document, A).cropNormalized, crop, wide.viewport),
    );
    expect(panelOf(next, A).frameMm).toEqual({ x: 20, y: 20, width: 20, height: 20 });
    const after = contentPlacement(panelOf(next, A).frameMm, panelOf(next, A).cropNormalized, wide.viewport);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.scale).toBe(before.scale);
    const restored = run(next, [{ type: "panel.setCrop", panelId: A, cropNormalized: { x: 0, y: 0, width: 1, height: 1 } }]);
    expect(restored.panels[A]?.frameMm).toEqual(document.panels[A]?.frameMm);
    expect(restored.panels[A]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const outside = codeOf(() =>
      run(document, [{ type: "panel.setCrop", panelId: A, cropNormalized: { x: 0.8, y: 0, width: 0.5, height: 1 } }]),
    );
    expect(outside.code).toBe("DOCUMENT_INVALID");
    expect(document.panels[A]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("rejects a frame that breaks aspect or leaves the canvas", () => {
    const document = placed();
    expect(
      codeOf(() =>
        run(document, [{ type: "panel.setFrames", items: [{ panelId: A, frameMm: { x: 10, y: 20, width: 40, height: 30 } }] }]),
      ).code,
    ).toBe("DOCUMENT_INVALID");
    const edge = run(createDefaultFigureDocument(), [
      {
        type: "panel.add",
        panelId: A,
        assetId: WIDE,
        frameMm: { x: 165, y: 20, width: 10, height: 10 },
        cropNormalized: { x: 0, y: 0, width: 0.5, height: 1 },
      },
    ]);
    expect(edge.panels[A]?.frameMm).toEqual({ x: 165, y: 20, width: 10, height: 10 });
    expect(
      codeOf(() => run(edge, [{ type: "panel.setCrop", panelId: A, cropNormalized: { x: 0, y: 0, width: 1, height: 1 } }])).code,
    ).toBe("OUTSIDE_CANVAS");
  });

  it("compiles align, distribute, and equal height into one setFrames command", () => {
    const document = placed();
    const align = alignSelection(document, [C, A, B], "left", { kind: "selection" });
    expect(align.type).toBe("panel.setFrames");
    const aligned = run(document, [align]);
    expect(aligned.panels[A]?.frameMm).toEqual(document.panels[A]?.frameMm);
    expect(aligned.panels[B]?.frameMm).toMatchObject({ x: 10, width: 40, height: 20 });
    expect(aligned.panels[C]?.frameMm).toMatchObject({ x: 10, width: 20, height: 10 });
    expect(aligned.panels[A]?.cropNormalized).toEqual(document.panels[A]?.cropNormalized);
    expect(aligned.panelOrder).toEqual(document.panelOrder);

    const distribute = distributeSelection(document, [A, B, C], "horizontal");
    expect(distribute.type).toBe("panel.setFrames");
    const distributed = run(document, [distribute]);
    expect(distributed.panels[A]?.frameMm.x).toBe(10);
    expect(distributed.panels[B]?.frameMm.x).toBe(65);
    expect(distributed.panels[C]?.frameMm.x).toBe(120);
    expect(distributed.panels[B]?.frameMm.width).toBe(40);

    const equal = equalSizeSelection(document, [C, A], "height");
    expect(equal.type).toBe("panel.setFrames");
    if (equal.type !== "panel.setFrames") return;
    expect(equal.items.find((item) => item.panelId === A)?.frameMm).toEqual(document.panels[A]?.frameMm);
    const sized = run(document, [equal]);
    expect(sized.panels[C]?.frameMm).toEqual({ x: 120, y: 20, width: 40, height: 20 });
    expect(
      aspectMatches(panelOf(sized, C).frameMm, panelOf(sized, C).cropNormalized, wide.viewport),
    ).toBe(true);

    const nudge = translateSelection(document, [B], NUDGE_MM.step, 0);
    expect(run(document, [nudge]).panels[B]?.frameMm.x).toBeCloseTo(60.1, 6);
    expect(run(document, [translateSelection(document, [B], NUDGE_MM.shiftStep, 0)]).panels[B]?.frameMm.x).toBe(61);
  });

  it("moves a rigid group together and rejects a partial edit", () => {
    const document = run(placed(), [{ type: "group.create", groupId: GROUP, name: "Pair", panelIds: [A, B] }]);
    const drag = translateSelection(document, [A], 4, -2);
    expect(drag.type === "panel.setFrames" && drag.items.map((item) => item.panelId).sort()).toEqual([A, B]);
    const moved = run(document, [drag]);
    expect(moved.panels[A]?.frameMm).toEqual({ x: 14, y: 18, width: 40, height: 20 });
    expect(moved.panels[B]?.frameMm).toEqual({ x: 64, y: 18, width: 40, height: 20 });
    expect(moved.groups[GROUP]?.panelIds).toEqual([A, B]);

    const partial = codeOf(() =>
      run(document, [{ type: "panel.setFrames", items: [{ panelId: A, frameMm: { x: 14, y: 20, width: 40, height: 20 } }] }]),
    );
    expect(partial.code).toBe("GROUP_PARTIAL_EDIT");
    expect(partial.details.panelIds).toEqual([A, B]);
    expect(
      codeOf(() => run(document, [scalePanel(document, A, { width: 20 }, "top-left")])).code,
    ).toBe("GROUP_PARTIAL_EDIT");
    expect(
      codeOf(() => run(document, [{ type: "panel.setCrop", panelId: A, cropNormalized: { x: 0, y: 0, width: 0.5, height: 1 } }])).code,
    ).toBe("GROUP_PARTIAL_EDIT");
    expect(codeOf(() => run(document, [{ type: "panel.replaceAsset", panelId: A, assetId: SQUARE }])).code).toBe(
      "GROUP_PARTIAL_EDIT",
    );
    expect(document.panels[A]?.frameMm.x).toBe(10);

    const ungrouped = run(document, [
      { type: "group.remove", groupId: GROUP },
      { type: "panel.setCrop", panelId: A, cropNormalized: { x: 0, y: 0, width: 0.5, height: 1 } },
    ]);
    expect(ungrouped.groups[GROUP]).toBeUndefined();
    expect(ungrouped.panels[A]?.cropNormalized.width).toBe(0.5);
  });

  it("rejects locked geometry and still allows rename, labels, and stack order", () => {
    const locked = run(placed(), [{ type: "panel.setLocked", panelIds: [A], locked: true }]);
    const error = codeOf(() => run(locked, [translateSelection(locked, [A], 1, 0)]));
    expect(error.code).toBe("LOCKED_ELEMENT");
    expect(error.details.panelIds).toEqual([A]);
    expect(codeOf(() => run(locked, [{ type: "panel.remove", panelIds: [A] }])).code).toBe("LOCKED_ELEMENT");
    expect(codeOf(() => run(locked, [{ type: "panel.setCrop", panelId: A, cropNormalized: { x: 0, y: 0, width: 0.5, height: 1 } }])).code).toBe(
      "LOCKED_ELEMENT",
    );
    expect(codeOf(() => run(locked, [{ type: "panel.replaceAsset", panelId: A, assetId: SQUARE }])).code).toBe("LOCKED_ELEMENT");
    const swapped = run(locked, [{ type: "panel.replaceAsset", panelId: A, assetId: WIDE_COPY }]);
    expect(swapped.panels[A]?.assetId).toBe(WIDE_COPY);
    expect(swapped.panels[A]?.frameMm).toEqual(locked.panels[A]?.frameMm);
    expect(swapped.panels[A]?.locked).toBe(true);
    const renamed = run(locked, [
      { type: "panel.rename", panelId: A, name: "Hero" },
      stackOrderCommand(locked, A, "front"),
    ]);
    expect(renamed.panels[A]?.name).toBe("Hero");
    expect(renamed.stackOrder).toEqual([B, C, A]);
    expect(renamed.panelOrder).toEqual([A, B, C]);
    expect(resolvePanelLabel(renamed, A)?.text).toBe("A");
    const grouped = run(placed(), [
      { type: "group.create", groupId: GROUP, name: "Pair", panelIds: [A, B] },
      { type: "group.setLocked", groupId: GROUP, locked: true },
    ]);
    expect(codeOf(() => run(grouped, [translateSelection(grouped, [A, B], 2, 0)])).code).toBe("LOCKED_ELEMENT");
    expect(codeOf(() => run(grouped, [{ type: "panel.remove", panelIds: [A, B] }])).code).toBe("LOCKED_ELEMENT");
    const dissolved = run(grouped, [{ type: "group.remove", groupId: GROUP }]);
    expect(dissolved.groups[GROUP]).toBeUndefined();
    expect(dissolved.panels[A]?.frameMm).toEqual(placed().panels[A]?.frameMm);
  });

  it("updates labels, stack order, replacement frames, and deletion bookkeeping", () => {
    const styled = run(placed(), [
      {
        type: "label.setOverrides",
        items: [
          {
            panelId: A,
            value: { visible: null, text: "Zed", placement: null, offsetMm: null, typography: null },
          },
        ],
      },
      {
        type: "label.setStyle",
        labelStyle: { ...placed().labelStyle, format: "parentheses" },
      },
    ]);
    expect(resolvePanelLabel(styled, A)?.text).toBe("Zed");
    expect(resolvePanelLabel(styled, B)?.text).toBe("(B)");
    const reordered = run(styled, [{ type: "panel.reorderLabels", panelOrder: [B, A, C], resetTextOverrides: false }]);
    expect(resolvePanelLabel(reordered, A)?.text).toBe("Zed");
    expect(resolvePanelLabel(reordered, B)?.text).toBe("(A)");
    expect(reordered.stackOrder).toEqual([A, B, C]);
    const cleared = run(reordered, [{ type: "panel.reorderLabels", panelOrder: [A, B, C], resetTextOverrides: true }]);
    expect(cleared.panels[A]?.labelOverrides.text).toBeNull();
    expect(resolvePanelLabel(cleared, A)?.text).toBe("(A)");

    expect(movedStackOrder([A, B, C], B, "forward")).toEqual([A, C, B]);
    expect(movedStackOrder([A, B, C], B, "backward")).toEqual([B, A, C]);
    expect(movedStackOrder([A, B, C], A, "front")).toEqual([B, C, A]);
    expect(movedStackOrder([A, B, C], C, "back")).toEqual([C, A, B]);
    expect(movedStackOrder([A, B, C], C, "forward")).toEqual([A, B, C]);

    const replaced = run(placed(), [{ type: "panel.replaceAsset", panelId: A, assetId: SQUARE }]);
    expect(replaced.panels[A]?.assetId).toBe(SQUARE);
    expect(replaced.panels[A]?.name).toBe("wide.png");
    expect(replaced.panels[A]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(replaced.panels[A]?.frameMm).toEqual({ x: 20, y: 20, width: 20, height: 20 });
    expect(aspectMatches(panelOf(replaced, A).frameMm, panelOf(replaced, A).cropNormalized, square.viewport)).toBe(true);

    const withMeta = run(placed(), [
      {
        type: "layout.setSettings",
        layoutSettings: {
          ...placed().layoutSettings,
          gutterMm: { horizontal: 3, vertical: 3 },
          primaryPanelId: A,
          constraints: [{ id: CONSTRAINT, kind: "equalHeight", panelIds: [A, B] }],
        },
      },
    ]);
    expect(withMeta.layoutSettings.gutterMm.horizontal).toBe(3);
    expect(withMeta.panels[B]?.frameMm).toEqual(placed().panels[B]?.frameMm);
    const brokenRow = run(withMeta, [
      { type: "panel.setFrames", items: [{ panelId: B, frameMm: { x: 60, y: 40, width: 40, height: 20 } }] },
    ]);
    expect(brokenRow.layoutSettings.constraints).toHaveLength(1);
    expect(codeOf(() => run(withMeta, [{ type: "group.create", groupId: GROUP, name: "Pair", panelIds: [A, B] }])).code).toBe(
      "DOCUMENT_INVALID",
    );
    const removed = run(withMeta, [{ type: "panel.remove", panelIds: [A] }]);
    expect(removed.panels[A]).toBeUndefined();
    expect(removed.panelOrder).toEqual([B, C]);
    expect(removed.stackOrder).toEqual([B, C]);
    expect(removed.layoutSettings.primaryPanelId).toBeNull();
    expect(removed.layoutSettings.constraints).toEqual([]);
    expect(resolvePanelLabel(removed, B)?.text).toBe("A");
    const grouped = run(placed(), [{ type: "group.create", groupId: GROUP, name: "Trio", panelIds: [A, B, C] }]);
    const left = run(grouped, [{ type: "panel.remove", panelIds: [C] }]);
    expect(left.groups[GROUP]?.panelIds).toEqual([A, B]);
    expect(run(left, [{ type: "panel.remove", panelIds: [B] }]).groups[GROUP]).toBeUndefined();
  });

  it("resizes the canvas only when the same transaction keeps content inside", () => {
    const document = placed();
    const canvas = { ...document.canvas, heightMm: 36 };
    expect(codeOf(() => run(document, [{ type: "canvas.set", canvas }])).code).toBe("OUTSIDE_CANVAS");
    const refit = run(document, [
      { type: "canvas.set", canvas },
      {
        type: "panel.setFrames",
        items: [
          { panelId: A, frameMm: { x: 10, y: 12, width: 40, height: 20 } },
          { panelId: B, frameMm: { x: 60, y: 12, width: 40, height: 20 } },
        ],
      },
    ]);
    expect(refit.canvas.heightMm).toBe(36);
    expect(refit.panels[A]?.frameMm.y).toBe(12);
    expect(refit.panels[C]?.frameMm.y).toBe(20);
  });

  it("aligns a group as one unit", () => {
    const document = run(placed(), [{ type: "group.create", groupId: GROUP, name: "Pair", panelIds: [A, B] }]);
    const command = alignSelection(document, [A, C], "right", { kind: "selection" });
    expect(command.type === "panel.setFrames" && command.items.map((item) => item.panelId).sort()).toEqual([A, B, C]);
    const aligned = run(document, [command]);
    expect(aligned.panels[A]?.frameMm.x).toBe(50);
    expect(document.panels[A]?.frameMm.x).toBe(10);
    expect(aligned.panels[B]?.frameMm.x).toBe(100);
    expect(aligned.panels[A]?.frameMm.width).toBe(40);
    expect(aligned.panels[C]?.frameMm).toEqual(document.panels[C]?.frameMm);
  });
});
