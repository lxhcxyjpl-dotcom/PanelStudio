import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOLERANCES,
  createDefaultFigureDocument,
  type FigureDocumentV1,
  type LayoutRequest,
} from "@panelstudio/contracts";
import {
  applyCommands,
  aspectMatches,
  canonicalJson,
  framesNearlyEqual,
  rectIsOnCanvas,
  resolvePanelLabel,
} from "@panelstudio/core";
import { describe, expect, it } from "vitest";
import { solveLayout, type LayoutAssetFacts, type SolveLayoutResult, type SolvedCandidate } from "./index.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/layout");

type FixturePanel = {
  id: number;
  aspect: [number, number];
  frame: [number, number, number, number];
  pixels?: number;
};

type Fixture = {
  id: string;
  expect: "candidates" | "conflict";
  family?: LayoutRequest["family"];
  primary?: number | null;
  locked?: number[];
  groups?: Array<{ id: string; panels: number[] }>;
  constraints?: Array<{ id: string; kind: "row" | "equalWidth" | "equalHeight"; panels: number[] }>;
  conflictPanels?: number[];
  conflictConstraints?: string[];
  panels: FixturePanel[];
  labelPlacement?: "outside-top-left" | "inside-top-left";
  gapMm?: number;
  pixels?: number;
};

function panelId(id: number): string {
  return `11111111-1111-4111-8111-11111111111${id}`;
}

function assetId(id: number): string {
  return `22222222-2222-4222-8222-22222222222${id}`;
}

function loadFixture(name: string): { document: FigureDocumentV1; assets: Record<string, LayoutAssetFacts>; request: LayoutRequest; fixture: Fixture } {
  const fixture = JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Fixture;
  return { ...materialize(fixture), fixture };
}

function materialize(fixture: Fixture): { document: FigureDocumentV1; assets: Record<string, LayoutAssetFacts>; request: LayoutRequest } {
  const document = createDefaultFigureDocument();
  if (fixture.labelPlacement) document.labelStyle.placement = fixture.labelPlacement;
  if (fixture.gapMm !== undefined) document.labelStyle.gapMm = fixture.gapMm;
  const assets: Record<string, LayoutAssetFacts> = {};
  const locked = new Set(fixture.locked ?? []);
  for (const panel of fixture.panels) {
    const id = panelId(panel.id);
    const asset = assetId(panel.id);
    const [x, y, width, height] = panel.frame;
    const [aspectW, aspectH] = panel.aspect;
    document.panels[id] = {
      assetId: asset,
      name: `P${panel.id}`,
      frameMm: { x, y, width, height },
      cropNormalized: { x: 0, y: 0, width: 1, height: 1 },
      locked: locked.has(panel.id),
      labelOverrides: { visible: null, text: null, placement: null, offsetMm: null, typography: null },
    };
    document.panelOrder.push(id);
    document.stackOrder.push(id);
    const pixels = panel.pixels ?? fixture.pixels ?? 4000;
    assets[asset] = {
      viewport: { width: aspectW * 100, height: aspectH * 100 },
      rasterPixelSize: { width: pixels, height: Math.round((pixels * aspectH) / aspectW) },
    };
  }
  for (const group of fixture.groups ?? []) {
    document.groups[group.id] = {
      name: "Group",
      panelIds: group.panels.map(panelId),
      locked: false,
    };
  }
  if (fixture.primary) document.layoutSettings.primaryPanelId = panelId(fixture.primary);
  document.layoutSettings.constraints = (fixture.constraints ?? []).map((constraint) => ({
    id: constraint.id,
    kind: constraint.kind,
    panelIds: constraint.panels.map(panelId),
  }));
  const request: LayoutRequest = { family: fixture.family ?? "auto" };
  if (fixture.primary) request.primaryPanelId = panelId(fixture.primary);
  return { document, assets, request };
}

function solved(result: SolveLayoutResult): SolvedCandidate[] {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return [];
  return result.candidates;
}

function geometryKey(document: FigureDocumentV1): string {
  return document.panelOrder
    .map((id) => {
      const frame = document.panels[id]?.frameMm;
      return frame ? [frame.x, frame.y, frame.width, frame.height].join(",") : "";
    })
    .join("|");
}

function assertCandidateLaw(document: FigureDocumentV1, assets: Record<string, LayoutAssetFacts>, candidate: SolvedCandidate): void {
  expect(candidate.commands.length).toBeGreaterThan(0);
  expect(candidate.commands.every((command) => command.type === "panel.setFrames" || command.type === "canvas.set")).toBe(true);
  const applied = applyCommands(document, candidate.commands, (id) => {
    const facts = assets[id];
    if (!facts) return null;
    return { id, originalFilename: "asset", viewport: facts.viewport, rasterPixelSize: facts.rasterPixelSize };
  });
  expect(canonicalJson(applied)).toBe(canonicalJson(candidate.previewDocument));
  const preview = candidate.previewDocument;
  expect(preview.panelOrder).toEqual(document.panelOrder);
  for (const panelId of preview.panelOrder) {
    const panel = preview.panels[panelId];
    const asset = panel ? assets[panel.assetId] : undefined;
    expect(panel && asset && aspectMatches(panel.frameMm, panel.cropNormalized, asset.viewport)).toBe(true);
    if (!panel) continue;
    expect(rectIsOnCanvas(panel.frameMm, preview.canvas)).toBe(true);
    expect(panel.frameMm.width).toBeGreaterThanOrEqual(preview.layoutSettings.minPanelSizeMm.width - TOLERANCES.geometryComparisonMm);
    expect(panel.frameMm.height).toBeGreaterThanOrEqual(preview.layoutSettings.minPanelSizeMm.height - TOLERANCES.geometryComparisonMm);
    const label = resolvePanelLabel(preview, panelId);
    if (label) {
      expect(rectIsOnCanvas(label.bounds, preview.canvas)).toBe(true);
      expect(label.bounds.y).toBeGreaterThanOrEqual(preview.canvas.marginsMm.top - TOLERANCES.geometryComparisonMm);
      expect(label.bounds.x).toBeGreaterThanOrEqual(preview.canvas.marginsMm.left - TOLERANCES.geometryComparisonMm);
      expect(label.bounds.x + label.bounds.width).toBeLessThanOrEqual(
        preview.canvas.widthMm - preview.canvas.marginsMm.right + TOLERANCES.geometryComparisonMm,
      );
    }
    if (document.panels[panelId]?.locked) {
      expect(framesNearlyEqual(panel.frameMm, document.panels[panelId].frameMm)).toBe(true);
    }
  }
  for (const group of Object.values(document.groups)) {
    const anchor = group.panelIds[0];
    if (!anchor) continue;
    const before = document.panels[anchor]?.frameMm;
    const after = preview.panels[anchor]?.frameMm;
    if (!before || !after) continue;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    for (const member of group.panelIds) {
      const current = document.panels[member]?.frameMm;
      const next = preview.panels[member]?.frameMm;
      expect(current && next).toBeTruthy();
      if (!current || !next) continue;
      expect(next.x - current.x).toBeCloseTo(dx, 6);
      expect(next.y - current.y).toBeCloseTo(dy, 6);
      expect(next.width).toBeCloseTo(current.width, 6);
      expect(next.height).toBeCloseTo(current.height, 6);
    }
  }
  const ids = preview.panelOrder;
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const a = preview.panels[ids[left] ?? ""]?.frameMm;
      const b = preview.panels[ids[right] ?? ""]?.frameMm;
      if (!a || !b) continue;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      expect(overlapX > TOLERANCES.geometryComparisonMm && overlapY > TOLERANCES.geometryComparisonMm).toBe(false);
    }
  }
}

describe("layout fixtures", () => {
  const files = readdirSync(fixtureDir).filter((name) => name.endsWith(".json")).sort();

  it("covers representative 2 to 8 panel cases", () => {
    expect(files).toEqual([
      "eight-panels.json",
      "five-panels.json",
      "four-panels.json",
      "hero-primary.json",
      "locked-panel.json",
      "rigid-group.json",
      "seven-panels.json",
      "six-panels.json",
      "three-panels.json",
      "two-panels.json",
      "unsatisfiable-constraints.json",
    ]);
  });

  for (const file of files) {
    it(file, () => {
      const { document, assets, request, fixture } = loadFixture(file);
      const before = canonicalJson(document);
      const result = solveLayout({ document, request, assets });
      expect(canonicalJson(document)).toBe(before);
      if (fixture.expect === "conflict") {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("LAYOUT_CONFLICT");
        for (const panel of fixture.conflictPanels ?? []) {
          expect(result.details.panelIds).toContain(panelId(panel));
        }
        for (const constraintId of fixture.conflictConstraints ?? []) {
          expect(result.details.constraintIds).toContain(constraintId);
        }
        return;
      }
      const candidates = solved(result);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(3);
      expect(new Set(candidates.map((candidate) => geometryKey(candidate.previewDocument))).size).toBe(candidates.length);
      for (const candidate of candidates) assertCandidateLaw(document, assets, candidate);
      expect(solveLayout({ document, request, assets })).toEqual(result);
    });
  }
});

describe("layout families", () => {
  const { document, assets } = materialize({
    id: "families",
    expect: "candidates",
    panels: [
      { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
      { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      { id: 3, aspect: [3, 1], frame: [120, 20, 45, 15] },
    ],
  });

  it("packs continuous rows", () => {
    const candidates = solved(solveLayout({ document, assets, request: { family: "rows" } }));
    expect(candidates.every((candidate) => candidate.summary.startsWith("均衡分行"))).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("puts the primary alone on the top row", () => {
    const request: LayoutRequest = { family: "hero-top", primaryPanelId: panelId(2) };
    const candidates = solved(solveLayout({ document, assets, request }));
    expect(candidates.every((candidate) => candidate.summary.startsWith("主图在上"))).toBe(true);
    for (const candidate of candidates) {
      const primary = candidate.previewDocument.panels[panelId(2)]?.frameMm;
      expect(primary).toBeTruthy();
      if (!primary) continue;
      for (const id of [panelId(1), panelId(3)]) {
        const frame = candidate.previewDocument.panels[id]?.frameMm;
        expect(frame && frame.y).toBeGreaterThan(primary.y + primary.height - TOLERANCES.geometryComparisonMm);
      }
      expect(primary.width).toBeGreaterThan(100);
    }
  });

  it("puts the primary on the left and aligns the tops", () => {
    const request: LayoutRequest = { family: "hero-left", primaryPanelId: panelId(2) };
    const candidates = solved(solveLayout({ document, assets, request }));
    expect(candidates.every((candidate) => candidate.summary.startsWith("主图在左"))).toBe(true);
    for (const candidate of candidates) {
      const primary = candidate.previewDocument.panels[panelId(2)]?.frameMm;
      expect(primary).toBeTruthy();
      if (!primary) continue;
      const others = [panelId(1), panelId(3)].map((id) => candidate.previewDocument.panels[id]?.frameMm);
      expect(others.every((frame) => frame && frame.x >= primary.x + primary.width - TOLERANCES.geometryComparisonMm)).toBe(true);
      expect(others.some((frame) => frame && Math.abs(frame.y - primary.y) <= TOLERANCES.geometryComparisonMm)).toBe(true);
    }
  });

  it("searches families, deduplicates, and does not pad to three", () => {
    const wide = materialize({
      id: "dedup",
      expect: "candidates",
      primary: 2,
      panels: [
        { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
        { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      ],
    });
    const candidates = solved(
      solveLayout({
        document: wide.document,
        assets: wide.assets,
        request: { family: "auto", primaryPanelId: panelId(2) },
      }),
    );
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.length).toBeGreaterThan(1);
    expect(new Set(candidates.map((candidate) => geometryKey(candidate.previewDocument))).size).toBe(candidates.length);
    expect(candidates.some((candidate) => candidate.summary.startsWith("均衡分行"))).toBe(true);
    expect(candidates.some((candidate) => candidate.summary.startsWith("主图"))).toBe(true);
    const onlyOne = solved(
      solveLayout({
        document: wide.document,
        assets: wide.assets,
        request: { family: "rows", rows: [[`panel:${panelId(1)}`, `panel:${panelId(2)}`]] },
      }),
    );
    expect(onlyOne).toHaveLength(1);
    const capped = solved(solveLayout({ document: wide.document, assets: wide.assets, request: { family: "auto", primaryPanelId: panelId(2) }, maxCandidates: 1 }));
    expect(capped).toHaveLength(1);
  });

  it("rejects a hero request without a primary", () => {
    const result = solveLayout({ document, assets, request: { family: "hero-left" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("REQUEST_INVALID");
  });
});

describe("label reservation and soft raster PPI", () => {
  it("keeps outside labels inside the margin and pushes content down as the gap grows", () => {
    const tight = materialize({
      id: "gap-tight",
      expect: "candidates",
      gapMm: 1,
      panels: [
        { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
        { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      ],
    });
    const loose = materialize({
      id: "gap-loose",
      expect: "candidates",
      gapMm: 8,
      panels: [
        { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
        { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      ],
    });
    const tightFrame = solved(solveLayout({ document: tight.document, assets: tight.assets, request: { family: "rows" } }))[0]
      ?.previewDocument.panels[panelId(1)]?.frameMm;
    const looseFrame = solved(solveLayout({ document: loose.document, assets: loose.assets, request: { family: "rows" } }))[0]
      ?.previewDocument.panels[panelId(1)]?.frameMm;
    expect(tightFrame && looseFrame && looseFrame.y).toBeGreaterThan((tightFrame?.y ?? 0) + 5);
    const preview = solved(solveLayout({ document: loose.document, assets: loose.assets, request: { family: "rows" } }))[0]?.previewDocument;
    expect(preview).toBeTruthy();
    if (!preview) return;
    const label = resolvePanelLabel(preview, panelId(1));
    expect(label && label.bounds.y).toBeGreaterThanOrEqual(preview.canvas.marginsMm.top - TOLERANCES.geometryComparisonMm);
    expect(label && preview.panels[panelId(1)] && label.bounds.y + label.bounds.height).toBeLessThanOrEqual(
      (preview.panels[panelId(1)]?.frameMm.y ?? 0) + TOLERANCES.geometryComparisonMm,
    );
  });

  it("lets an inside label overlap its own frame and not the neighbor", () => {
    const inside = materialize({
      id: "inside",
      expect: "candidates",
      labelPlacement: "inside-top-left",
      panels: [
        { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
        { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      ],
    });
    const candidate = solved(solveLayout({ document: inside.document, assets: inside.assets, request: { family: "rows" } }))[0];
    expect(candidate).toBeTruthy();
    if (!candidate) return;
    const frame = candidate.previewDocument.panels[panelId(1)]?.frameMm;
    const other = candidate.previewDocument.panels[panelId(2)]?.frameMm;
    const label = resolvePanelLabel(candidate.previewDocument, panelId(1));
    expect(frame && label).toBeTruthy();
    if (!frame || !label || !other) return;
    expect(frame.y).toBeCloseTo(inside.document.canvas.marginsMm.top, 3);
    const overlapsOwn =
      Math.min(frame.x + frame.width, label.bounds.x + label.bounds.width) - Math.max(frame.x, label.bounds.x) > 0 &&
      Math.min(frame.y + frame.height, label.bounds.y + label.bounds.height) - Math.max(frame.y, label.bounds.y) > 0;
    expect(overlapsOwn).toBe(true);
    const overlapsNeighbor =
      Math.min(other.x + other.width, label.bounds.x + label.bounds.width) - Math.max(other.x, label.bounds.x) >
        TOLERANCES.geometryComparisonMm &&
      Math.min(other.y + other.height, label.bounds.y + label.bounds.height) - Math.max(other.y, label.bounds.y) >
        TOLERANCES.geometryComparisonMm;
    expect(overlapsNeighbor).toBe(false);
  });

  it("warns when raster PPI is below target and still returns candidates", () => {
    const low = materialize({
      id: "ppi",
      expect: "candidates",
      pixels: 30,
      panels: [
        { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
        { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      ],
    });
    const result = solveLayout({ document: low.document, assets: low.assets, request: { family: "rows" } });
    const candidates = solved(result);
    expect(candidates.some((candidate) => candidate.diagnostics.some((item) => item.code === "LAYOUT_PPI_BELOW_TARGET" && item.severity === "warning"))).toBe(true);
    expect(candidates.every((candidate) => candidate.score.penalties.readability !== "unknown")).toBe(true);
  });
});

describe("locks that already match a template", () => {
  it("keeps a locked panel that the chosen template does not need to move", () => {
    const sample = materialize({
      id: "lock-keep",
      expect: "candidates",
      panels: [
        { id: 1, aspect: [2, 1], frame: [10, 20, 40, 20] },
        { id: 2, aspect: [2, 1], frame: [70, 20, 40, 20] },
      ],
    });
    const first = solved(solveLayout({ document: sample.document, assets: sample.assets, request: { family: "rows" } }))[0];
    expect(first).toBeTruthy();
    if (!first) return;
    const locked = structuredClone(first.previewDocument);
    const id = panelId(1);
    const panel = locked.panels[id];
    expect(panel).toBeTruthy();
    if (!panel) return;
    panel.locked = true;
    const again = solved(solveLayout({ document: locked, assets: sample.assets, request: { family: "rows" } }));
    expect(again.length).toBeGreaterThan(0);
    expect(again.length).toBeLessThan(solved(solveLayout({ document: sample.document, assets: sample.assets, request: { family: "rows" } })).length + 1);
    for (const candidate of again) {
      expect(framesNearlyEqual(candidate.previewDocument.panels[id]?.frameMm ?? panel.frameMm, panel.frameMm)).toBe(true);
    }
  });
});
