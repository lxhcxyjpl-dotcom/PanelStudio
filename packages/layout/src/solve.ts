import {
  DEFAULT_MAX_AUTO_HEIGHT_MM,
  RESOURCE_LIMITS,
  TOLERANCES,
  type Diagnostic,
  type DomainCommand,
  type FigureDocumentV1,
  type LayoutRequest,
  type LayoutScore,
} from "@panelstudio/contracts";
import {
  DocumentCommandError,
  resolvePanelLabel,
  framesNearlyEqual,
} from "@panelstudio/core";
import {
  hasExplicitOrder,
  hasExplicitRows,
  assetFacts,
  autoHeightLimit,
  balancedRowCounts,
  croppedAspect,
  occupiedRects,
  nearly,
  patternKey,
  compositions,
  MAX_AUTO_ROW_UNITS,
  MIN_WIDE_PANEL_ASPECT,
  splitUnits,
  type LayoutAssetFacts,
  type Rect,
  type Unit,
} from "./measure.js";
import { parseUnitList } from "./units.js";
import { assertLayoutConstraints, validateCandidateResult } from "./validate.js";
import { solveLocalRow } from "./local-row.js";
import { solveGuided } from "./guided.js";
import { placeCompactStack, placeHeroLeft, placeStack, type Placement, type RowEmphasis } from "./place.js";
import { scoreLayout, type ConcreteFamily } from "./score.js";

export type { LayoutAssetFacts } from "./measure.js";

export type SolveLayoutInput = {
  document: FigureDocumentV1;
  request: LayoutRequest;
  assets: Readonly<Record<string, LayoutAssetFacts>>;
  maxCandidates?: 1 | 2 | 3;
};

type GlobalRequest = Exclude<LayoutRequest, { family: "selection-row" | "guided" }>;

export type SolvedCandidate = {
  family: ConcreteFamily | "selection-row" | "guided";
  summary: string;
  commands: DomainCommand[];
  previewDocument: FigureDocumentV1;
  score: LayoutScore;
  diagnostics: Diagnostic[];
};

export type SolveLayoutFailure = {
  ok: false;
  code: DocumentCommandError["code"] | "REQUEST_INVALID";
  message: string;
  details: DocumentCommandError["details"];
};

export type SolveLayoutResult = { ok: true; candidates: SolvedCandidate[] } | SolveLayoutFailure;

type FailureKind = "lock" | "constraint" | "min-size" | "overlap" | "margin" | "height" | "fit";

type Failure = {
  kind: FailureKind;
  message: string;
  panelIds: string[];
  constraintIds: string[];
};

const FAILURE_RANK: Record<FailureKind, number> = {
  lock: 0,
  constraint: 1,
  "min-size": 2,
  overlap: 3,
  margin: 4,
  height: 5,
  fit: 6,
};

type Attempt = {
  family: ConcreteFamily;
  rows: Unit[][];
  primaryId: string | null;
  compositionCost: number;
};

type RankedCandidate = { result: SolvedCandidate; compositionCost: number };

/**
 * Deterministic candidate search for handbook section 7.
 * The input document is not modified. Each candidate's preview is the document
 * produced by applying that candidate's commands.
 */
export function solveLayout(input: SolveLayoutInput): SolveLayoutResult {
  for (const id of input.document.panelOrder) {
    const measured = resolvePanelLabel(input.document, id)?.measurement;
    if (measured?.status === "unavailable") {
      return { ok: false, code: "TEXT_METRICS_UNAVAILABLE", message: "A label cannot be measured with its selected font.",
        details: { reason: measured.reason, panelIds: [id] } };
    }
  }
  if (input.request.family === "selection-row") return solveLocalRow({ ...input, request: input.request });
  if (input.request.family === "guided") return solveGuided({ ...input, request: input.request });
  const prepared = prepare({ ...input, request: input.request });
  if (!prepared.ok) return prepared;
  const failures = new Map<FailureKind, Failure>();
  const found: RankedCandidate[] = [];
  for (const attempt of prepared.attempts) {
    let outcome = evaluate(input.document, input.assets, prepared, attempt);
    if (!outcome.ok && outcome.failure.kind === "height" && prepared.expandedAutoHeightLimitMm > prepared.autoHeightLimitMm) {
      outcome = evaluate(input.document, input.assets, { ...prepared, autoHeightLimitMm: prepared.expandedAutoHeightLimitMm }, attempt);
    }
    if (outcome.ok) found.push({ result: outcome.candidate, compositionCost: attempt.compositionCost });
    else remember(failures, outcome.failure);
  }
  const limit =
    input.maxCandidates === 1 || input.maxCandidates === 2 || input.maxCandidates === 3
      ? input.maxCandidates
      : RESOURCE_LIMITS.maxLayoutCandidates;
  const candidates = dedupe(found).slice(0, limit).map(({ result }) => result);
  if (candidates.length > 0) return { ok: true, candidates };
  const failure = bestFailure(failures);
  return {
    ok: false,
    code: "LAYOUT_CONFLICT",
    message: failure?.message ?? "No layout satisfies the hard constraints.",
    details: detailsOf(failure),
  };
}

type Prepared = {
  ok: true;
  units: Unit[];
  attempts: Attempt[];
  primaryId: string | null;
  widthMm: number;
  heightMode: "auto" | "fixed";
  fixedHeightMm: number;
  autoHeightLimitMm: number;
  expandedAutoHeightLimitMm: number;
  gutterH: number;
  gutterV: number;
  compactExplicitRows: boolean;
  emphasis?: RowEmphasis;
};

function prepare(input: Omit<SolveLayoutInput, "request"> & { request: GlobalRequest }): Prepared | SolveLayoutFailure {
  const { document, request } = input;
  const panelIds = document.panelOrder;
  if (
    panelIds.length < RESOURCE_LIMITS.minAutoLayoutPanels ||
    panelIds.length > RESOURCE_LIMITS.maxAutoLayoutPanels ||
    Object.keys(document.panels).length !== panelIds.length
  ) {
    return invalid("REQUEST_INVALID", `Automatic layout supports ${RESOURCE_LIMITS.minAutoLayoutPanels} to ${RESOURCE_LIMITS.maxAutoLayoutPanels} panels.`);
  }
  const missingAssets: string[] = [];
  const missingPanels: string[] = [];
  for (const panelId of panelIds) {
    const panel = document.panels[panelId];
    if (!panel || !input.assets[panel.assetId]) {
      missingPanels.push(panelId);
      if (panel) missingAssets.push(panel.assetId);
    }
  }
  if (missingPanels.length > 0) {
    return invalid("DOCUMENT_INVALID", "A panel references an asset the layout engine cannot measure.", {
      panelIds: unique(missingPanels),
      assetIds: unique(missingAssets),
    });
  }
  const membership = new Map<string, string>();
  for (const [groupId, group] of Object.entries(document.groups)) {
    for (const panelId of group.panelIds) {
      if (!document.panels[panelId]) {
        return invalid("DOCUMENT_INVALID", "A group names a missing panel.", { panelIds: [panelId] });
      }
      if (membership.has(panelId)) {
        return invalid("DOCUMENT_INVALID", "A panel belongs to more than one group.", { panelIds: [panelId] });
      }
      membership.set(panelId, groupId);
    }
  }
  const primaryId = request.primaryPanelId ?? document.layoutSettings.primaryPanelId ?? null;
  if (primaryId && !document.panels[primaryId]) {
    return invalid("REQUEST_INVALID", "The primary panel does not exist.", { panelIds: [primaryId] });
  }
  if (primaryId && membership.has(primaryId)) {
    const code = request.primaryPanelId ? "REQUEST_INVALID" : "DOCUMENT_INVALID";
    return invalid(code, "The primary panel must be an ungrouped panel.", { panelIds: [primaryId] });
  }
  if ((request.family === "hero-top" || request.family === "hero-left") && !primaryId) {
    return invalid("REQUEST_INVALID", "A hero layout needs an ungrouped primary panel.");
  }

  const parsed = parseUnits(document, membership, request, primaryId);
  if (!parsed.ok) return parsed.failure;
  const widthMm = request.canvasOverride?.widthMm ?? document.canvas.widthMm;
  const heightMode = request.canvasOverride?.heightMode ?? document.canvas.heightMode;
  const fixedHeightMm =
    heightMode === "fixed" ? (request.canvasOverride?.heightMm ?? document.canvas.heightMm) : document.canvas.heightMm;
  const autoHeightLimitMm = autoHeightLimit(document);
  const intent = "emphasis" in request ? request.emphasis : undefined;
  let emphasis: RowEmphasis | undefined;
  let expandedAutoHeightLimitMm = autoHeightLimitMm;
  if (intent) {
    if (request.family !== "rows" || !hasExplicitRows(request) || !request.primaryPanelId) {
      return invalid("REQUEST_INVALID", "Emphasis requires complete explicit rows and a primary panel.");
    }
    const alignedRows = alignedRowIndices(request.rows, intent.alignedRows ?? []);
    if (!alignedRows) return invalid("REQUEST_INVALID", "Aligned rows must name distinct, consecutive singleton panel rows in order.");
    emphasis = { minimumWidthMm: intent.minimumWidthMm, alignedRows };
    if (heightMode === "auto" && document.canvas.heightMode === "auto" &&
        document.layoutSettings.maxAutoHeightMm === DEFAULT_MAX_AUTO_HEIGHT_MM) {
      expandedAutoHeightLimitMm = Math.max(autoHeightLimitMm,
        Math.min(intent.maxAutoHeightMm ?? autoHeightLimitMm, DEFAULT_MAX_AUTO_HEIGHT_MM * 2));
    }
  }
  const gutterH = request.gutterOverrideMm?.horizontal ?? document.layoutSettings.gutterMm.horizontal;
  const gutterV = request.gutterOverrideMm?.vertical ?? document.layoutSettings.gutterMm.vertical;
  return {
    ok: true,
    units: parsed.units,
    attempts: buildAttempts(request.family, parsed, primaryId, input),
    primaryId,
    widthMm,
    heightMode,
    fixedHeightMm,
    autoHeightLimitMm,
    expandedAutoHeightLimitMm,
    gutterH,
    gutterV,
    compactExplicitRows: hasExplicitRows(request),
    ...(emphasis ? { emphasis } : {}),
  };
}

function alignedRowIndices(rows: string[][], groups: string[][]): number[][] | null {
  const used = new Set<number>();
  const indexBySingleton = new Map(rows.flatMap((row, index) => row.length === 1 && row[0]?.startsWith("panel:") ? [[row[0], index] as const] : []));
  const aligned: number[][] = [];
  for (const group of groups) {
    if (group.length < 2) return null;
    const indices: number[] = [];
    for (const unit of group) {
      const index = indexBySingleton.get(unit);
      if (index === undefined || used.has(index) || (indices.length && index !== indices.at(-1)! + 1)) return null;
      used.add(index);
      indices.push(index);
    }
    aligned.push(indices);
  }
  return aligned;
}

function buildAttempts(
  family: GlobalRequest["family"],
  { units, explicitRows, rowMode }: ParsedUnits,
  primaryId: string | null,
  { document, assets }: Pick<SolveLayoutInput, "document" | "assets">,
): Attempt[] {
  const families: ConcreteFamily[] =
    family === "auto" ? ["rows", "hero-top", "hero-left"] : [family];
  const secondary = primaryId ? units.filter((unit) => !unitContains(unit, primaryId)) : units;
  const aspects = new Map<Unit, number>();
  if (!explicitRows) for (const unit of units) {
    const aspect = unit.kind === "panel" && croppedAspect(document, assets, unit.panelId);
    if (aspect) aspects.set(unit, aspect);
  }
  const wide = widePanels(aspects);
  const attempts: Attempt[] = [];
  for (const item of families) {
    if (item !== "rows" && !primaryId) continue;
    if (item === "rows" && rowMode === "secondary") continue;
    if (item !== "rows" && rowMode === "full") continue;
    const source = item === "rows" ? units : secondary;
    const pairs = wide.size && units.length > 8 ? pairedFollowers(source, aspects, wide) : new Set<Unit>();
    const rowSets =
      explicitRows && rowMode !== "search"
        ? [explicitRows]
        : candidateRows(source, wide, pairs);
    for (const rows of rowSets) {
      if (item !== "rows" && rows.length === 0) continue;
      const reducedWide = rows.reduce((total, row) =>
        total + (item === "hero-left" || row.length > 1 ? row.filter((unit) => wide.has(unit)).length : 0), 0);
      const splitPairs = rows.filter((row) => pairs.has(row[0]!)).length;
      const dense = rows.some((row) => row.length > 3);
      attempts.push({ family: item, rows, primaryId,
        compositionCost: reducedWide * (RESOURCE_LIMITS.maxAutoLayoutPanels + 1) + splitPairs * 2 + Number(dense) });
    }
  }
  return attempts;
}

function widePanels(aspects: Map<Unit, number>): Set<Unit> {
  const measured = [...aspects.values()].sort((a, b) => a - b);
  if (measured.length < 4) return new Set();
  const center = (measured[Math.floor((measured.length - 1) / 2)]! + measured[Math.floor(measured.length / 2)]!) / 2;
  return new Set([...aspects].filter(([, aspect]) => aspect >= Math.max(MIN_WIDE_PANEL_ASPECT, center * 1.45)).map(([unit]) => unit));
}

function pairedFollowers(units: Unit[], aspects: Map<Unit, number>, wide: Set<Unit>): Set<Unit> {
  const followers = new Set<Unit>();
  for (let index = 1; index < units.length; index++) {
    const first = units[index - 1]!, second = units[index]!;
    const a = aspects.get(first), b = aspects.get(second);
    if (!a || !b || wide.has(first) || wide.has(second) || followers.has(first)) continue;
    if (Math.abs(a - b) <= Math.max(a, b) * 0.02) followers.add(second);
  }
  return followers;
}

function candidateRows(units: Unit[], wide: Set<Unit>, pairs: Set<Unit>): Unit[][][] {
  const patterns = compositions(units.length);
  if (units.some((unit) => wide.has(unit))) {
    const maxColumns = units.length > 8 ? MAX_AUTO_ROW_UNITS : 3;
    // A wide multi-part plot keeps its own row. Fill the contiguous runs between
    // wide plots without changing the source order or choosing a scientific story.
    for (let columns = 2; columns <= maxColumns; columns++) {
      const pattern: number[] = [];
      let run = 0;
      for (const unit of units) {
        if (wide.has(unit)) {
          if (run) pattern.push(...balancedRowCounts(run, columns));
          pattern.push(1);
          run = 0;
        } else run++;
      }
      if (run) pattern.push(...balancedRowCounts(run, columns));
      patterns.push(pattern);
      if (pairs.size) {
        const pairedRows: number[] = [];
        let count = 0;
        for (const [index, unit] of units.entries()) {
          if (pairs.has(unit)) continue;
          const size = pairs.has(units[index + 1]!) ? 2 : 1;
          if (count && (wide.has(unit) || count + size > columns)) {
            pairedRows.push(count);
            count = 0;
          }
          if (wide.has(unit)) pairedRows.push(1);
          else count += size;
        }
        if (count) pairedRows.push(count);
        patterns.push(pairedRows);
      }
    }
  }
  return [...new Map(patterns.map((p) => [p.join("-"), p])).values()].map((p) => splitUnits(units, p));
}

type ParsedUnits = {
  ok: true;
  units: Unit[];
  explicitRows: Unit[][] | null;
  rowMode: "full" | "secondary" | "search";
};

function parseUnits(
  document: FigureDocumentV1,
  membership: Map<string, string>,
  request: GlobalRequest,
  primaryId: string | null,
): ParsedUnits | { ok: false; failure: SolveLayoutFailure } {
  if (hasExplicitRows(request) && hasExplicitOrder(request)) {
    return { ok: false, failure: invalid("REQUEST_INVALID", "Provide either ordered units or rows, not both.") };
  }
  if (hasExplicitRows(request)) {
    const seen = new Set<string>();
    const rows: Unit[][] = [];
    for (const row of request.rows) {
      const parsed = parseUnitList(document, membership, row, seen);
      if (!parsed.ok) return { ok: false, failure: parsed.failure };
      rows.push(parsed.units);
    }
    const missing = document.panelOrder.filter((panelId) => !seen.has(panelId));
    if (missing.length === 0) {
      if (request.family === "hero-top" || request.family === "hero-left") {
        return {
          ok: false,
          failure: invalid("REQUEST_INVALID", "Hero rows describe only the secondary region.", {
            panelIds: primaryId ? [primaryId] : undefined,
          }),
        };
      }
      return { ok: true, units: rows.flat(), explicitRows: rows, rowMode: "full" };
    }
    if (primaryId && missing.length === 1 && missing[0] === primaryId) {
      if (request.family === "rows") {
        return {
          ok: false,
          failure: invalid("REQUEST_INVALID", "A rows layout must include every panel.", { panelIds: missing }),
        };
      }
      return { ok: true, units: defaultUnits(document, membership), explicitRows: rows, rowMode: "secondary" };
    }
    return {
      ok: false,
      failure: invalid("REQUEST_INVALID", "The layout must include every panel exactly once.", { panelIds: missing }),
    };
  }
  if (hasExplicitOrder(request)) {
    const seen = new Set<string>();
    const parsed = parseUnitList(document, membership, request.orderedUnitIds, seen);
    if (!parsed.ok) return { ok: false, failure: parsed.failure };
    const missing = document.panelOrder.filter((panelId) => !seen.has(panelId));
    if (missing.length > 0) {
      return {
        ok: false,
        failure: invalid("REQUEST_INVALID", "The layout must include every panel exactly once.", { panelIds: missing }),
      };
    }
    return { ok: true, units: parsed.units, explicitRows: null, rowMode: "search" };
  }
  return { ok: true, units: defaultUnits(document, membership), explicitRows: null, rowMode: "search" };
}

function defaultUnits(document: FigureDocumentV1, membership: Map<string, string>): Unit[] {
  const units: Unit[] = [];
  const seen = new Set<string>();
  for (const panelId of document.panelOrder) {
    if (seen.has(panelId)) continue;
    const groupId = membership.get(panelId);
    if (!groupId) {
      seen.add(panelId);
      units.push({ kind: "panel", panelId });
      continue;
    }
    const group = document.groups[groupId];
    if (!group) continue;
    for (const member of group.panelIds) seen.add(member);
    units.push({ kind: "group", groupId, panelIds: [...group.panelIds] });
  }
  return units;
}

type Evaluation = { ok: true; candidate: SolvedCandidate } | { ok: false; failure: Failure };

function evaluate(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  prepared: Prepared,
  attempt: Attempt,
): Evaluation {
  const margins = document.canvas.marginsMm;
  const innerWidth = prepared.widthMm - margins.left - margins.right;
  const everyone = document.panelOrder;
  if (!(innerWidth > 0)) {
    return { ok: false, failure: { kind: "fit", message: "The canvas has no usable width.", panelIds: everyone, constraintIds: [] } };
  }
  const placed = placeAttempt(document, assets, prepared, attempt, margins.left, margins.top, innerWidth);
  if (!placed || placed.frames.size !== everyone.length) {
    return {
      ok: false,
      failure: { kind: "fit", message: "This row arrangement does not fit the canvas width.", panelIds: everyone, constraintIds: [] },
    };
  }
  if (prepared.emphasis && attempt.primaryId &&
      placed.frames.get(attempt.primaryId)!.width + TOLERANCES.geometryComparisonMm < prepared.emphasis.minimumWidthMm) {
    return { ok: false, failure: { kind: "fit", message: "The emphasized panel cannot reach the requested width in these rows.",
      panelIds: [attempt.primaryId], constraintIds: [] } };
  }
  for (const panelId of everyone) {
    if (!placed.frames.has(panelId)) {
      return {
        ok: false,
        failure: { kind: "fit", message: "This row arrangement does not place every panel.", panelIds: [panelId], constraintIds: [] },
      };
    }
  }
  for (const group of Object.values(document.groups)) {
    if (!groupStaysRigid(document, placed.frames, group.panelIds)) {
      return {
        ok: false,
        failure: {
          kind: "fit",
          message: "A group was not kept rigid.",
          panelIds: [...group.panelIds],
          constraintIds: [],
        },
      };
    }
  }
  const locked = everyone.filter((panelId) => {
    if (!isProtected(document, panelId)) return false;
    const next = placed.frames.get(panelId);
    const current = document.panels[panelId]?.frameMm;
    return !next || !current || !framesNearlyEqual(current, next);
  });
  if (locked.length > 0) {
    return {
      ok: false,
      failure: { kind: "lock", message: "Locked panels cannot move or scale.", panelIds: locked, constraintIds: [] },
    };
  }
  try {
    assertLayoutConstraints(document, (id) => placed.frames.get(id)!);
  } catch (error) {
    if (!(error instanceof DocumentCommandError)) throw error;
    return { ok: false, failure: { kind: "constraint", message: error.message,
      panelIds: error.details.panelIds ?? [], constraintIds: error.details.constraintIds ?? [] } };
  }
  const boxes = everyone.flatMap((id) => occupiedRects(document, id, placed.frames.get(id)!));
  let bottom = margins.top;
  for (const box of boxes) bottom = Math.max(bottom, box.y + box.height);
  const needed = bottom + margins.bottom;
  if (prepared.heightMode === "auto") {
    if (needed > prepared.autoHeightLimitMm + TOLERANCES.geometryComparisonMm) {
      return {
        ok: false,
        failure: {
          kind: "height",
          message: "The layout is taller than the automatic height limit.",
          panelIds: everyone,
          constraintIds: [],
        },
      };
    }
  } else if (needed > prepared.fixedHeightMm + TOLERANCES.geometryComparisonMm) {
    return {
      ok: false,
      failure: { kind: "height", message: "The layout does not fit the fixed canvas height.", panelIds: everyone, constraintIds: [] },
    };
  }
  const nextCanvas = {
    ...document.canvas,
    widthMm: prepared.widthMm,
    heightMm: prepared.heightMode === "auto" ? needed : prepared.fixedHeightMm,
    heightMode: prepared.heightMode,
  };
  const items = everyone.map((panelId) => {
    const current = document.panels[panelId]?.frameMm;
    const next = placed.frames.get(panelId);
    const frameMm = current && next && framesNearlyEqual(current, next) ? { ...current } : next;
    if (!frameMm) {
      return null;
    }
    return { panelId, frameMm };
  });
  if (items.some((item) => item === null)) {
    return {
      ok: false,
      failure: { kind: "fit", message: "This row arrangement does not place every panel.", panelIds: everyone, constraintIds: [] },
    };
  }
  const frames = items.filter((item): item is { panelId: string; frameMm: Rect } => item !== null);
  const commands: DomainCommand[] = [];
  if (frames.some((item) => !framesNearlyEqual(document.panels[item.panelId]?.frameMm ?? item.frameMm, item.frameMm))) {
    commands.push({ type: "panel.setFrames", items: frames });
  }
  if (prepared.emphasis) {
    const settings = document.layoutSettings;
    const extended = nextCanvas.heightMode === "auto" && needed > autoHeightLimit(document) + TOLERANCES.geometryComparisonMm;
    if (extended || settings.primaryPanelId !== attempt.primaryId) {
      commands.push({ type: "layout.setSettings", layoutSettings: {
        ...settings, primaryPanelId: attempt.primaryId, maxAutoHeightMm: extended ? needed : settings.maxAutoHeightMm,
      } });
    }
  }
  const canvasUnchanged =
    nextCanvas.heightMode === document.canvas.heightMode &&
    nearly(nextCanvas.widthMm, document.canvas.widthMm) &&
    nearly(nextCanvas.heightMm, document.canvas.heightMm);
  if (!canvasUnchanged) commands.push({ type: "canvas.set", canvas: nextCanvas });
  try {
    const previewDocument = validateCandidateResult(document, commands, (assetId) => assetFacts(assets, assetId), "layout");
    const scored = scoreLayout(document, previewDocument, assets, attempt.family, attempt.primaryId);
    return {
      ok: true,
      candidate: {
        family: attempt.family,
        summary: summaryFor(attempt.family, attempt.rows),
        commands,
        previewDocument,
        score: scored.score,
        diagnostics: scored.diagnostics,
      },
    };
  } catch (error) {
    if (error instanceof DocumentCommandError) {
      const reasons: Partial<Record<NonNullable<SolveLayoutFailure["details"]["reason"]>, FailureKind>> = {
        "layout-constraint": "constraint", "layout-min-size": "min-size", "layout-overlap": "overlap",
        "layout-margin": "margin", "layout-max-height": "height",
      };
      const kind = error.code === "LOCKED_ELEMENT" ? "lock" : error.code === "OUTSIDE_CANVAS" ? "margin" :
        error.details.reason && reasons[error.details.reason] || "fit";
      return {
        ok: false,
        failure: {
          kind,
          message: error.message,
          panelIds: error.details.panelIds ?? everyone,
          constraintIds: error.details.constraintIds ?? [],
        },
      };
    }
    return {
      ok: false,
      failure: { kind: "fit", message: "This row arrangement could not be applied.", panelIds: everyone, constraintIds: [] },
    };
  }
}

function placeAttempt(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  prepared: Prepared,
  attempt: Attempt,
  originX: number,
  originY: number,
  innerWidth: number,
): Placement | null {
  if (attempt.family === "hero-left") {
    if (!attempt.primaryId) return null;
    return placeHeroLeft(
      document,
      assets,
      attempt.primaryId,
      attempt.rows,
      originX,
      originY,
      innerWidth,
      prepared.gutterH,
      prepared.gutterV,
    );
  }
  const rows =
    attempt.family === "hero-top" && attempt.primaryId
      ? [[{ kind: "panel" as const, panelId: attempt.primaryId }], ...attempt.rows]
      : attempt.rows;
  if (prepared.compactExplicitRows) {
    const height = prepared.heightMode === "fixed" ? prepared.fixedHeightMm : prepared.autoHeightLimitMm;
    return placeCompactStack(document, assets, rows, originX, originY, innerWidth, prepared.gutterH,
      prepared.gutterV, height - document.canvas.marginsMm.bottom, attempt.primaryId, prepared.emphasis);
  }
  return placeStack(document, assets, rows, originX, originY, innerWidth, prepared.gutterH, prepared.gutterV);
}

function summaryFor(family: ConcreteFamily, rows: Unit[][]): string {
  const shape = patternKey(rows);
  if (family === "rows") return `均衡分行 ${shape}`;
  if (family === "hero-top") return `主图在上 ${shape}`;
  return `主图在左 ${shape}`;
}

function groupStaysRigid(document: FigureDocumentV1, frames: Map<string, Rect>, panelIds: string[]): boolean {
  const anchorId = panelIds[0];
  if (!anchorId) return false;
  const before = document.panels[anchorId]?.frameMm;
  const after = frames.get(anchorId);
  if (!before || !after) return false;
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  return panelIds.every((panelId) => {
    const current = document.panels[panelId]?.frameMm;
    const next = frames.get(panelId);
    if (!current || !next) return false;
    return (
      nearly(next.x - current.x, dx) &&
      nearly(next.y - current.y, dy) &&
      nearly(next.width, current.width) &&
      nearly(next.height, current.height)
    );
  });
}

function isProtected(document: FigureDocumentV1, panelId: string): boolean {
  if (document.panels[panelId]?.locked) return true;
  return Object.values(document.groups).some((group) => group.locked && group.panelIds.includes(panelId));
}

function unitContains(unit: Unit, panelId: string): boolean {
  return unit.kind === "panel" ? unit.panelId === panelId : unit.panelIds.includes(panelId);
}

function dedupe(candidates: RankedCandidate[]): RankedCandidate[] {
  const kept = new Map<string, RankedCandidate>();
  for (const candidate of candidates) {
    const key = geometryKey(candidate.result.previewDocument);
    const current = kept.get(key);
    if (!current || prefer(candidate, current)) kept.set(key, candidate);
  }
  return [...kept.values()].sort((left, right) => {
    if (prefer(left, right)) return -1;
    if (prefer(right, left)) return 1;
    return 0;
  });
}

function geometryKey(document: FigureDocumentV1): string {
  const parts: string[] = [
    document.canvas.heightMode,
    String(quantizeNumber(document.canvas.widthMm)),
    String(quantizeNumber(document.canvas.heightMm)),
  ];
  for (const panelId of document.panelOrder) {
    const frame = document.panels[panelId]?.frameMm;
    if (!frame) continue;
    parts.push(
      String(quantizeNumber(frame.x)),
      String(quantizeNumber(frame.y)),
      String(quantizeNumber(frame.width)),
      String(quantizeNumber(frame.height)),
    );
  }
  return parts.join(",");
}

function quantizeNumber(value: number): number {
  const step = TOLERANCES.geometryComparisonMm;
  return Math.round(value / step) * step;
}

function prefer(a: RankedCandidate, b: RankedCandidate): boolean {
  if (a.compositionCost !== b.compositionCost) return a.compositionCost < b.compositionCost;
  const left = a.result, right = b.result;
  const leftScore = left.score.total ?? 2;
  const rightScore = right.score.total ?? 2;
  if (leftScore !== rightScore) return leftScore < rightScore;
  const rank = familyRank(left.family) - familyRank(right.family);
  if (rank !== 0) return rank < 0;
  return left.summary < right.summary;
}

function familyRank(family: SolvedCandidate["family"]): number {
  if (family === "rows") return 0;
  if (family === "hero-top") return 1;
  return 2;
}

function remember(failures: Map<FailureKind, Failure>, failure: Failure): void {
  const existing = failures.get(failure.kind);
  if (!existing) {
    failures.set(failure.kind, {
      ...failure,
      panelIds: unique(failure.panelIds),
      constraintIds: unique(failure.constraintIds),
    });
    return;
  }
  existing.panelIds = unique([...existing.panelIds, ...failure.panelIds]);
  existing.constraintIds = unique([...existing.constraintIds, ...failure.constraintIds]);
}

function bestFailure(failures: Map<FailureKind, Failure>): Failure | null {
  let best: Failure | null = null;
  for (const failure of failures.values()) {
    if (!best || FAILURE_RANK[failure.kind] < FAILURE_RANK[best.kind]) best = failure;
  }
  return best;
}

function detailsOf(failure: Failure | null): SolveLayoutFailure["details"] {
  if (!failure) return {};
  const reasons = { constraint: "layout-constraint", "min-size": "layout-min-size", overlap: "layout-overlap", margin: "layout-margin", height: "layout-max-height" } as const;
  return {
    ...(failure.kind in reasons ? { reason: reasons[failure.kind as keyof typeof reasons] } : {}),
    ...(failure.panelIds.length > 0 ? { panelIds: failure.panelIds } : {}),
    ...(failure.constraintIds.length > 0 ? { constraintIds: failure.constraintIds } : {}),
  };
}

function invalid(
  code: "REQUEST_INVALID" | "DOCUMENT_INVALID",
  message: string,
  details: SolveLayoutFailure["details"] = {},
): SolveLayoutFailure {
  return { ok: false, code, message, details };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
