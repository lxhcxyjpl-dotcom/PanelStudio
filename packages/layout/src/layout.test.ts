import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOLERANCES,
  createDefaultFigureDocument,
  layoutUnitIds,
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
import { solveLayout, validateCandidateResult, type LayoutAssetFacts, type SolveLayoutResult, type SolvedCandidate } from "./index.js";

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
  family?: Exclude<LayoutRequest["family"], "selection-row" | "guided">;
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
  return `11111111-1111-4111-8111-1111111111${String(id).padStart(2, "0")}`;
}

function assetId(id: number): string {
  return `22222222-2222-4222-8222-2222222222${String(id).padStart(2, "0")}`;
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

describe("guided layout", () => {
  const scene = () => loadFixture("six-panels.json");
  const [a, b, c] = [1, 2, 3].map((n) => "panel:" + panelId(n)) as [string, string, string];
  const slots = [[0,.10,.39,.46],[.41,.10,.59,.64],[0,.57,.39,.17],[0,.76,.39,.24],[.41,.76,.30,.24],[.73,.76,.27,.24]]
    .map(([x,y,width,height], i) => ({ unitId: "panel:" + panelId(i+1), x: x!, y: y!, width: width!, height: height! }));
  it("keeps a two-row spanning panel, labels, crop and original asset references; combines focus and adjacency", () => {
    const input = scene();
    const right = solved(solveLayout({ ...input, request: {family:"guided", referenceAspect: 1.10, referenceSlots:slots,
      preferences:{focus:b, pair:{first:a,second:c,axis:"vertical"},gapMm:4}} }));
    for (const { previewDocument: d, commands } of right) {
      expect(d.panelOrder).toEqual(input.document.panelOrder);
      expect(d.stackOrder).toEqual(input.document.stackOrder);
      const [fa,fb,fc] = [1,2,3].map((i) => d.panels[panelId(i)]!.frameMm) as [Frame,Frame,Frame];
      expect(fb.x).toBeGreaterThanOrEqual(fa.x+fa.width);
      expect(fc.y).toBeGreaterThan(fa.y+fa.height);
      expect(fb.height).toBeGreaterThan(fa.height);
      expect(d.layoutSettings.gutterMm).toEqual({horizontal:4,vertical:4});
      for (const id of d.panelOrder) {
        expect(d.panels[id]!.labelOverrides).toEqual(input.document.panels[id]!.labelOverrides);
        expect(d.panels[id]!.assetId).toBe(input.document.panels[id]!.assetId);
        expect(d.panels[id]!.cropNormalized).toEqual(input.document.panels[id]!.cropNormalized);
      }
      const replay = validateCandidateResult(input.document,commands,(id) => ({id,originalFilename:"image",...input.assets[id]!}),"layout");
      expect(replay).toEqual(d);
    }
  });
  type Frame = FigureDocumentV1["panels"][string]["frameMm"];
  it("returns an explicit conflict for overlapping, incomplete or contradictory references", () => {
    const input = scene();
    const check = (referenceSlots: typeof slots, focus?: string) => solveLayout({...input,
      request:{family:"guided", referenceSlots, preferences:{focus}}});
    expect(check(slots.slice(1))).toMatchObject({ok:false,details:{reason:"reference-slots"}});
    expect(check(slots.map((s) => ({...s,x:0,y:0})))).toMatchObject({ok:false,details:{reason:"reference-structure"}});
    expect(check(slots.map((s) => ({...s,unitId:a})))).toMatchObject({ok:false,details:{reason:"reference-slots"}});
    expect(check(slots.map((s,i) => i === 0 ? {...s,x:0.9} : s))).toMatchObject({ok:false,details:{reason:"reference-slots"}});
    expect(check(slots,c)).toMatchObject({ok:false,details:{reason:"guided-preferences"}});
    expect(check(slots,"panel:"+panelId(8))).toMatchObject({ok:false,code:"REQUEST_INVALID"});
  });
  it("can emphasize one of two equal-aspect assets, honors fixed canvases and keeps groups rigid", () => {
    const input = loadFixture("two-panels.json");
    const second = input.document.panels[panelId(2)]!;
    input.assets[second.assetId] = {...input.assets[input.document.panels[panelId(1)]!.assetId]!};
    second.frameMm.height = input.document.panels[panelId(1)]!.frameMm.height * second.frameMm.width / input.document.panels[panelId(1)]!.frameMm.width;
    const candidates = solved(solveLayout({...input,request:{family:"guided",preferences:{focus:b,shape:"square"}}}));
    expect(candidates.every(({previewDocument:d}) => Math.abs(d.canvas.heightMm-d.canvas.widthMm) < 1)).toBe(true);
    input.document.canvas = {...input.document.canvas,heightMode:"fixed",heightMm:100};
    expect(solveLayout({...input,request:{family:"guided",preferences:{shape:"tall"}}})).toMatchObject({ok:false});
    const grouped = loadFixture("rigid-group.json"), ids = layoutUnitIds(grouped.document);
    expect(ids).toHaveLength(2);
    const rigid = solved(solveLayout({...grouped,request:{family:"guided",preferences:{gapMm:4}}}))[0]!.previewDocument;
    for (const i of [1,2]) expect(rigid.panels[panelId(i)]!.frameMm.width).toBe(grouped.document.panels[panelId(i)]!.frameMm.width);
    expect(rigid.panels[panelId(1)]!.frameMm.x - rigid.panels[panelId(2)]!.frameMm.x).toBeCloseTo(-48);
    grouped.document.panels[panelId(1)]!.locked = true;
    expect(solveLayout({...grouped,request:{family:"guided",preferences:{gapMm:4}}})).toMatchObject({ok:false,code:"LOCKED_ELEMENT"});
  });
});

function assertCandidateLaw(document: FigureDocumentV1, assets: Record<string, LayoutAssetFacts>, candidate: SolvedCandidate, allowSettings = false): void {
  expect(candidate.commands.length).toBeGreaterThan(0);
  expect(candidate.commands.every(command => command.type === "panel.setFrames" || command.type === "canvas.set" ||
    (allowSettings && command.type === "layout.setSettings"))).toBe(true);
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
    if (label?.bounds) {
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

describe("automatic layouts for many panels", () => {
  function figure(aspects: Array<[number, number]>) {
    return materialize({
      id: "many-panels",
      expect: "candidates",
      panels: aspects.map(([w, h], index) => ({
        id: index + 1,
        aspect: [w, h],
        frame: [12, 12, 40, 40 * h / w],
      })),
    });
  }

  const tenAspects: Array<[number, number]> = [
    [169, 100], [169, 100], [148, 100], [148, 100], [169, 100],
    [156, 100], [156, 100], [121, 100], [305, 100], [305, 100],
  ];

  it("gives each wide multipart plot its own row and scales grouped rows proportionately", () => {
    const input = figure(tenAspects);
    const [candidate] = solved(solveLayout(input));
    assertCandidateLaw(input.document, input.assets, candidate!);
    const d = candidate!.previewDocument;
    const wide = [9, 10].map((index) => d.panels[panelId(index)]!.frameMm);
    for (const frame of wide) {
      const availableWidth = d.canvas.widthMm - d.canvas.marginsMm.left - d.canvas.marginsMm.right;
      expect(frame.width).toBeGreaterThan(availableWidth * 0.98);
      const sharingBand = d.panelOrder.map((id) => d.panels[id]!.frameMm)
        .filter((other) => other.y < frame.y + frame.height - 1e-4 && other.y + other.height > frame.y + 1e-4);
      expect(sharingBand).toEqual([frame]);
    }
    expect(d.panels[panelId(1)]!.frameMm.width).toBeLessThan(wide[0]!.width);
    for (const [first, second] of [[1, 2], [3, 4], [6, 7]]) {
      expect(d.panels[panelId(first!)]!.frameMm.y).toBeCloseTo(d.panels[panelId(second!)]!.frameMm.y);
    }
  });

  it("keeps the requested hero and paired comparison rows", () => {
    const input = figure(tenAspects);
    const [candidate] = solved(solveLayout({ ...input, request: {
      family: "hero-top",
      primaryPanelId: panelId(8),
      rows: [[1, 2], [3, 4, 5], [6, 7], [9], [10]]
        .map((row) => row.map((id) => "panel:" + panelId(id))),
    } }));
    assertCandidateLaw(input.document, input.assets, candidate!);
    const d = candidate!.previewDocument;
    const frame = (index: number) => d.panels[panelId(index)]!.frameMm;
    expect(frame(8).y).toBeLessThan(frame(1).y);
    expect(frame(8).width).toBeGreaterThan(frame(1).width);
    expect(frame(6).y).toBeCloseTo(frame(7).y);
    expect(frame(6).width).toBeCloseTo(frame(7).width);
  });

  it("lays out 32 assets with standard and guided requests, preserving the panel count", () => {
    const input = figure(Array.from({ length: 32 }, () => [3, 2] as [number, number]));
    const [standard] = solved(solveLayout(input));
    assertCandidateLaw(input.document, input.assets, standard!);
    const [guided] = solved(solveLayout({ ...input, request: { family: "guided", preferences: { gapMm: 4 } } }));
    assertCandidateLaw(input.document, input.assets, guided!);
  });

  it("respects fixed and customized height limits for large explicit layouts", () => {
    const input = figure(tenAspects);
    const request: LayoutRequest = { family: "rows", rows: [
      [1, 2], [3, 4], [5, 6], [7, 8], [9], [10],
    ].map((row) => row.map((id) => "panel:" + panelId(id))) };
    const [candidate] = solved(solveLayout({ ...input, request }));
    expect(candidate!.previewDocument.canvas.heightMm).toBeGreaterThan(input.document.layoutSettings.maxAutoHeightMm);
    input.document.layoutSettings.maxAutoHeightMm = 200;
    expect(solveLayout({ ...input, request })).toMatchObject({ ok: false, details: { reason: "layout-max-height" } });
    input.document.canvas.heightMode = "fixed";
    expect(solveLayout({ ...input, request })).toMatchObject({ ok: false, details: { reason: "layout-max-height" } });
  });

  it("compacts a tall singleton while preserving the exact comparison pairs at full width", () => {
    const input = figure([
      [2269, 1346], [2337, 1576], [2269, 1879], [2268, 1458],
      [2269, 1458], [3913, 1285], [3914, 1285],
    ]);
    const request: LayoutRequest = { family: "rows", rows: [[1, 2], [3], [4, 5], [6, 7]]
      .map(row => row.map(id => "panel:" + panelId(id))) };
    const frameOf = (doc: FigureDocumentV1, panel: number) => doc.panels[panelId(panel)]!.frameMm;
    const configured = input.document.layoutSettings.maxAutoHeightMm;
    input.document.layoutSettings.maxAutoHeightMm = 350;
    const [original] = solved(solveLayout({ ...input, request }));
    input.document.layoutSettings.maxAutoHeightMm = configured;

    const [compact] = solved(solveLayout({ ...input, request }));
    expect(original!.previewDocument.canvas.heightMm).toBeGreaterThan(configured);
    expect(compact!.previewDocument.canvas.heightMm).toBeCloseTo(configured);
    assertCandidateLaw(input.document, input.assets, compact!);
    expect(frameOf(compact!.previewDocument, 3).width).toBeLessThan(frameOf(original!.previewDocument, 3).width);
    expect(frameOf(compact!.previewDocument, 3).width).toBeGreaterThan(95);
    for (const [a, b] of [[1, 2], [4, 5], [6, 7]] as const) {
      const f = frameOf(compact!.previewDocument, a);
      const g = frameOf(compact!.previewDocument, b);
      expect(f.y).toBeCloseTo(g.y);
      expect(f.width).toBeCloseTo(frameOf(original!.previewDocument, a).width);
      expect(g.width).toBeCloseTo(frameOf(original!.previewDocument, b).width);
      expect(f.x).toBeLessThan(g.x);
    }
    expect(frameOf(compact!.previewDocument, 6).width).toBeGreaterThan(80);
    expect(frameOf(compact!.previewDocument, 7).width).toBeGreaterThan(80);

    input.document.canvas.heightMode = "fixed";
    input.document.canvas.heightMm = 230;
    const [fixed] = solved(solveLayout({ ...input, request }));
    expect(fixed!.previewDocument.canvas.heightMm).toBe(230);
    assertCandidateLaw(input.document, input.assets, fixed!);
    input.document.canvas.heightMm = 140;
    expect(solveLayout({ ...input, request })).toMatchObject({ ok: false, details: { reason: "layout-max-height" } });
  });

  it("keeps an explicit primary at full width when shortening another singleton", () => {
    const input = figure([[24, 10], [11, 10], [18, 10], [18, 10]]);
    const request: LayoutRequest = {
      family: "hero-top", primaryPanelId: panelId(1),
      rows: [[2], [3, 4]].map(row => row.map(id => "panel:" + panelId(id))),
    };
    const [candidate] = solved(solveLayout({ ...input, request }));
    const frames = candidate!.previewDocument.panels;
    expect(frames[panelId(1)]!.frameMm.width).toBeCloseTo(172);
    expect(frames[panelId(2)]!.frameMm.width).toBeLessThan(172);
    expect(frames[panelId(3)]!.frameMm.y).toBeCloseTo(frames[panelId(4)]!.frameMm.y);
    assertCandidateLaw(input.document, input.assets, candidate!);
  });

  it("promotes a middle panel while keeping paired rows aligned and an automatic height extension replayable", () => {
    const { document, assets } = figure([[17, 10], [15, 10], [12, 10], [15, 10], [15, 10], [30, 10], [32, 10]]);
    const unit = (id: number) => "panel:" + panelId(id);
    const [compact] = solved(solveLayout({ document, assets, request: {
      family: "rows", rows: [[1, 2], [3, 4, 5], [6], [7]].map(row => row.map(unit)),
    } }));
    const before = compact!.previewDocument;
    const request: LayoutRequest = {
      family: "rows", primaryPanelId: panelId(3), rows: [[1, 2], [3], [4, 5], [6], [7]].map(row => row.map(unit)),
      emphasis: { minimumWidthMm: 100, maxAutoHeightMm: 320, alignedRows: [[unit(6), unit(7)]] },
    };
    const [candidate] = solved(solveLayout({ document: before, assets, request }));
    assertCandidateLaw(before, assets, candidate!, true);
    const after = candidate!.previewDocument;
    const frame = (id: number) => after.panels[panelId(id)]!.frameMm;
    expect(frame(3).width).toBeGreaterThan(100);
    expect(frame(3).width).toBeGreaterThan(before.panels[panelId(3)]!.frameMm.width * 1.5);
    expect(frame(3).y).toBeGreaterThan(frame(1).y);
    expect(frame(4).y).toBeGreaterThan(frame(3).y);
    expect(frame(6).width).toBeGreaterThan(154);
    expect(frame(6).width).toBeCloseTo(frame(7).width, 8);
    expect(frame(6).x).toBeCloseTo(frame(7).x, 8);
    expect(frame(7).y).toBeGreaterThan(frame(6).y + frame(6).height);
    expect(after.canvas.heightMm).toBeGreaterThan(before.layoutSettings.maxAutoHeightMm);
    expect(after.canvas.heightMm).toBeLessThanOrEqual(320);
    expect(after.layoutSettings.maxAutoHeightMm).toBe(after.canvas.heightMm);
    expect(after.layoutSettings.primaryPanelId).toBe(panelId(3));
    expect(after.panelOrder).toEqual(before.panelOrder);

    const custom = { ...before, layoutSettings: { ...before.layoutSettings, maxAutoHeightMm: 250 } };
    expect(solveLayout({ document: custom, assets, request })).toMatchObject({ ok: false, details: { reason: "layout-max-height" } });
    const fixed = { ...before, canvas: { ...before.canvas, heightMode: "fixed" as const, heightMm: 320 } };
    const [fixedCandidate] = solved(solveLayout({ document: fixed, assets, request }));
    expect(fixedCandidate!.previewDocument.canvas).toEqual(fixed.canvas);
    expect(fixedCandidate!.previewDocument.layoutSettings.maxAutoHeightMm).toBe(before.layoutSettings.maxAutoHeightMm);
    expect(solveLayout({ document: before, assets, request: {
      ...request, emphasis: { ...request.emphasis!, alignedRows: [[unit(3), unit(7)]] },
    } })).toMatchObject({ ok: false, code: "REQUEST_INVALID" });
  });
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
    expect(label?.bounds?.y).toBeGreaterThanOrEqual(preview.canvas.marginsMm.top - TOLERANCES.geometryComparisonMm);
    expect(label?.bounds && preview.panels[panelId(1)] && label.bounds.y + label.bounds.height).toBeLessThanOrEqual(
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
    if (!frame || !label?.bounds || !other) return;
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

describe("selection row", () => {
  const a = panelId(1), b = panelId(2), c = panelId(3);
  const group = "44444444-4444-4444-8444-444444444444";
  const region = {x: 10, y: 10, width: 100, height: 70};
  function scene() {
    return materialize({id:"local", expect:"candidates", labelPlacement:"inside-top-left", panels:[
      {id:1, aspect:[2,1], frame:[10,18,40,20]},
      {id:2, aspect:[1,1], frame:[58,29,28,28]},
      {id:3, aspect:[1,1], frame:[135,20,22,22]},
    ]});
  }
  const request = (sizing: "preserve" | "equal-width" | "equal-height", orderedUnitIds = [`panel:${a}`,`panel:${b}`]) =>
    ({family:"selection-row" as const, orderedUnitIds, sizing, regionMm: region, gapMm:4});
  it("finds maximum feasible equal widths, preserves unselected objects and replays once", () => {
    const input = scene();
    const options = solved(solveLayout({...input,request:request("equal-width")}));
    expect(options).toHaveLength(1);
    const solution = options[0]!;
    const {panels} = solution.previewDocument;
    expect(panels[a]!.frameMm.width).toBeCloseTo(48, 8);
    expect(panels[a]!.frameMm.height).toBeCloseTo(24, 8);
    expect(panels[b]!.frameMm.width).toBeCloseTo(48, 8);
    expect(panels[b]!.frameMm.height).toBeCloseTo(48, 8);
    expect(panels[a]!.frameMm.y).toBe(panels[b]!.frameMm.y);
    expect(solution.commands).toMatchObject([{ type:"panel.setFrames", items:[{panelId:a},{panelId:b}]}]);
    const expected = structuredClone(input.document);
    expected.panels[a]!.frameMm = panels[a]!.frameMm;
    expected.panels[b]!.frameMm = panels[b]!.frameMm;
    expect(solution.previewDocument).toEqual(expected);
    expect(solveLayout({...input,request:request("equal-width")})).toEqual({ok:true,candidates:options});
  });
  it("finds an equal height, retains sizes in preserve mode, and bounds an omitted region", () => {
    const input = scene();
    const same = solved(solveLayout({...input, request:request("equal-height")}))[0]!;
    expect(same.previewDocument.panels[a]!.frameMm.height).toBeCloseTo(32, 8);
    expect(same.previewDocument.panels[b]!.frameMm.height).toBeCloseTo(32, 8);
    const {regionMm: _region, ...compact} = request("preserve");
    const kept = solved(solveLayout({...input,request:compact}))[0]!;
    expect(kept.previewDocument.panels[b]!.frameMm).toEqual({x:54,y:18,width:28,height:28});
  });
  it("uses the full ink rectangle even when the baseline is manually offset", () => {
    const input = scene();
    input.document.panels[b]!.labelOverrides.offsetMm = {x:-8,y:-3};
    const result = solved(solveLayout({...input,request:request("equal-width")}))[0]!.previewDocument;
    const label = resolvePanelLabel(result,b)!.bounds!;
    const f = result.panels[a]!.frameMm;
    expect(label.x - (f.x + f.width)).toBeCloseTo(4,6);
    expect(label.y).toBeCloseTo(region.y,6);
    expect(f.y).toBe(result.panels[b]!.frameMm.y);
    expect(f.width).toBeLessThan(48);
  });
  it("moves a complete rigid group, rejects group resizing and partial or repeated units", () => {
    const input = scene(), d = input.document;
    d.groups[group] = {name:"Pair",panelIds:[a,b],locked:false};
    const ordered = [`group:${group}`,`panel:${c}`];
    const regionMm = {x:8,y:12,width:160,height:80};
    const kept = solved(solveLayout({...input,request:{...request("preserve",ordered),regionMm}}))[0]!.previewDocument;
    expect(kept.panels[a]!.frameMm.width).toBe(d.panels[a]!.frameMm.width);
    expect(kept.panels[b]!.frameMm.x - kept.panels[a]!.frameMm.x).toBe(d.panels[b]!.frameMm.x-d.panels[a]!.frameMm.x);
    expect(kept.panels[b]!.frameMm.y - kept.panels[a]!.frameMm.y).toBe(d.panels[b]!.frameMm.y-d.panels[a]!.frameMm.y);
    expect(solveLayout({...input,request:request("equal-width",ordered)})).toMatchObject({ok:false, details:{reason:"group-resize"}});
    expect(solveLayout({...input,request:request("preserve")})).toMatchObject({ok:false, details:{reason:"invalid-units"}});
    expect(solveLayout({...input,request:request("preserve",[`panel:${c}`,`panel:${c}`])})).toMatchObject({ok:false, details:{reason:"invalid-units"}});
  });
  it("locates locked panels, cross-selection constraints, obstacles and insufficient regions", () => {
    const input = scene(), d = input.document;
    const options = {...input,request:request("preserve")};
    d.panels[a]!.locked = true;
    expect(solveLayout(options)).toMatchObject({ok:false,code:"LOCKED_ELEMENT",details:{panelIds:[a]}});
    d.panels[a]!.locked = false;
    d.layoutSettings.constraints = [{id:group,kind:"row",panelIds:[a,c]}];
    expect(solveLayout(options)).toMatchObject({ok:false,details:{reason:"cross-selection-constraint",constraintIds:[group]}});
    d.layoutSettings.constraints = [];
    d.panels[c]!.labelOverrides.offsetMm = {x:-40,y:4};
    expect(solveLayout(options)).toMatchObject({ok:false,details:{reason:"region-occupied",panelIds:[c]}});
    d.panels[c]!.labelOverrides.offsetMm = null;
    expect(solveLayout({...input,request:{...request("equal-width"),regionMm:{...region,width:18}}}))
      .toMatchObject({ok:false,details:{reason:"region-too-small"}});
    d.panels[c]!.frameMm = {...d.panels[c]!.frameMm,width:5,height:5};
    expect(solveLayout(options)).toMatchObject({ok:false,details:{reason:"outside-layout-conflict", panelIds:[c]}});
  });
  it("validates a solved layout after any descendant edit without re-solving", () => {
    const input = scene(), d = input.document;
    const lookup = (id:string) => ({id,originalFilename:"image",...input.assets[id]!});
    const placed = solved(solveLayout({...input,request:request("equal-width")}))[0]!;
    const collide = {type:"panel.setFrames" as const, items:[{panelId:c,frameMm:{x:15,y:15,width:22,height:22}}]};
    expect(validateCandidateResult(d,placed.commands,lookup,"layout")).toEqual(placed.previewDocument);
    expect(() => validateCandidateResult(d,[...placed.commands,collide],lookup,"edit")).not.toThrow();
    expect(() => validateCandidateResult(d,[...placed.commands,collide],lookup,"layout"))
      .toThrow(expect.objectContaining({code:"LAYOUT_CONFLICT",details:expect.objectContaining({reason:"layout-overlap"})}));
  });
});
