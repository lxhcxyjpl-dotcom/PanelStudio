import {
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
  applyCommands,
  framesNearlyEqual,
  type ReadyAssetFacts,
} from "@panelstudio/core";
import {
  hasExplicitOrder,
  hasExplicitRows,
  insideMargins,
  intersects,
  labelBounds,
  nearly,
  parseUnitId,
  patternKey,
  compositions,
  splitUnits,
  type LayoutAssetFacts,
  type Rect,
  type Unit,
} from "./measure.js";
import { placeHeroLeft, placeStack, type Placement } from "./place.js";
import { scoreLayout, type ConcreteFamily } from "./score.js";

export type { LayoutAssetFacts } from "./measure.js";

export type SolveLayoutInput = {
  document: FigureDocumentV1;
  request: LayoutRequest;
  assets: Readonly<Record<string, LayoutAssetFacts>>;
  maxCandidates?: 1 | 2 | 3;
};

export type SolvedCandidate = {
  family: ConcreteFamily;
  summary: string;
  commands: DomainCommand[];
  previewDocument: FigureDocumentV1;
  score: LayoutScore;
  diagnostics: Diagnostic[];
};

export type SolveLayoutFailure = {
  ok: false;
  code: "LAYOUT_CONFLICT" | "REQUEST_INVALID" | "DOCUMENT_INVALID";
  message: string;
  details: {
    panelIds?: string[];
    assetIds?: string[];
    constraintIds?: string[];
  };
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
};

/**
 * Deterministic candidate search for handbook section 7.
 * The input document is not modified. Each candidate's preview is the document
 * produced by applying that candidate's commands.
 */
export function solveLayout(input: SolveLayoutInput): SolveLayoutResult {
  const prepared = prepare(input);
  if (!prepared.ok) return prepared;
  const failures = new Map<FailureKind, Failure>();
  const found: SolvedCandidate[] = [];
  for (const attempt of prepared.attempts) {
    const outcome = evaluate(input.document, input.assets, prepared, attempt);
    if (outcome.ok) found.push(outcome.candidate);
    else remember(failures, outcome.failure);
  }
  const limit =
    input.maxCandidates === 1 || input.maxCandidates === 2 || input.maxCandidates === 3
      ? input.maxCandidates
      : RESOURCE_LIMITS.maxLayoutCandidates;
  const candidates = dedupe(found).slice(0, limit);
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
  gutterH: number;
  gutterV: number;
};

function prepare(input: SolveLayoutInput): Prepared | SolveLayoutFailure {
  const { document, request } = input;
  const panelIds = document.panelOrder;
  if (
    panelIds.length < RESOURCE_LIMITS.minAutoLayoutPanels ||
    panelIds.length > RESOURCE_LIMITS.maxAutoLayoutPanels ||
    Object.keys(document.panels).length !== panelIds.length
  ) {
    return invalid("REQUEST_INVALID", "Automatic layout supports 2 to 8 panels.");
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
  const gutterH = request.gutterOverrideMm?.horizontal ?? document.layoutSettings.gutterMm.horizontal;
  const gutterV = request.gutterOverrideMm?.vertical ?? document.layoutSettings.gutterMm.vertical;
  return {
    ok: true,
    units: parsed.units,
    attempts: buildAttempts(request.family, parsed.units, parsed.explicitRows, parsed.rowMode, primaryId),
    primaryId,
    widthMm,
    heightMode,
    fixedHeightMm,
    gutterH,
    gutterV,
  };
}

function buildAttempts(
  family: LayoutRequest["family"],
  units: Unit[],
  explicitRows: Unit[][] | null,
  rowMode: "full" | "secondary" | "search",
  primaryId: string | null,
): Attempt[] {
  const families: ConcreteFamily[] =
    family === "auto" ? ["rows", "hero-top", "hero-left"] : [family];
  const secondary = primaryId ? units.filter((unit) => !unitContains(unit, primaryId)) : units;
  const attempts: Attempt[] = [];
  for (const item of families) {
    if (item !== "rows" && !primaryId) continue;
    if (item === "rows" && rowMode === "secondary") continue;
    if (item !== "rows" && rowMode === "full") continue;
    const source = item === "rows" ? units : secondary;
    const rowSets =
      explicitRows && rowMode !== "search"
        ? [explicitRows]
        : compositions(source.length).map((pattern) => splitUnits(source, pattern));
    for (const rows of rowSets) {
      if (item !== "rows" && rows.length === 0) continue;
      attempts.push({ family: item, rows, primaryId });
    }
  }
  return attempts;
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
  request: LayoutRequest,
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

function parseUnitList(
  document: FigureDocumentV1,
  membership: Map<string, string>,
  ids: string[],
  seen: Set<string>,
): { ok: true; units: Unit[] } | { ok: false; failure: SolveLayoutFailure } {
  const units: Unit[] = [];
  const seenGroups = new Set<string>();
  for (const value of ids) {
    const parsed = parseUnitId(value);
    if (!parsed) return { ok: false, failure: invalid("REQUEST_INVALID", "A layout unit id is invalid.") };
    if (parsed.kind === "panel") {
      if (!document.panels[parsed.id]) {
        return { ok: false, failure: invalid("REQUEST_INVALID", "The layout names a missing panel.", { panelIds: [parsed.id] }) };
      }
      if (membership.has(parsed.id)) {
        return {
          ok: false,
          failure: invalid("REQUEST_INVALID", "A grouped panel can only participate as its group.", { panelIds: [parsed.id] }),
        };
      }
      if (seen.has(parsed.id)) {
        return { ok: false, failure: invalid("REQUEST_INVALID", "A panel is listed more than once.", { panelIds: [parsed.id] }) };
      }
      seen.add(parsed.id);
      units.push({ kind: "panel", panelId: parsed.id });
      continue;
    }
    const group = document.groups[parsed.id];
    if (!group) return { ok: false, failure: invalid("REQUEST_INVALID", "The layout names a missing group.") };
    if (seenGroups.has(parsed.id)) return { ok: false, failure: invalid("REQUEST_INVALID", "A group is listed more than once.") };
    seenGroups.add(parsed.id);
    for (const panelId of group.panelIds) {
      if (seen.has(panelId)) {
        return { ok: false, failure: invalid("REQUEST_INVALID", "A panel is listed more than once.", { panelIds: [panelId] }) };
      }
      seen.add(panelId);
    }
    units.push({ kind: "group", groupId: parsed.id, panelIds: [...group.panelIds] });
  }
  return { ok: true, units };
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
  for (const constraint of document.layoutSettings.constraints) {
    const frames: Rect[] = [];
    for (const panelId of constraint.panelIds) {
      const frame = placed.frames.get(panelId);
      if (!frame) {
        return {
          ok: false,
          failure: {
            kind: "constraint",
            message: "No layout satisfies the row, equal-width, or equal-height constraints.",
            panelIds: [...constraint.panelIds],
            constraintIds: [constraint.id],
          },
        };
      }
      frames.push(frame);
    }
    const anchor = frames[0];
    const satisfied =
      anchor !== undefined &&
      frames.every((frame) => {
        if (constraint.kind === "row") return nearly(frame.y, anchor.y);
        if (constraint.kind === "equalHeight") return nearly(frame.height, anchor.height);
        return nearly(frame.width, anchor.width);
      });
    if (!satisfied) {
      return {
        ok: false,
        failure: {
          kind: "constraint",
          message: "No layout satisfies the row, equal-width, or equal-height constraints.",
          panelIds: [...constraint.panelIds],
          constraintIds: [constraint.id],
        },
      };
    }
  }
  const minSize = document.layoutSettings.minPanelSizeMm;
  const tiny = everyone.filter((panelId) => {
    const frame = placed.frames.get(panelId);
    if (!frame) return true;
    return (
      frame.width < minSize.width - TOLERANCES.geometryComparisonMm ||
      frame.height < minSize.height - TOLERANCES.geometryComparisonMm
    );
  });
  if (tiny.length > 0) {
    return {
      ok: false,
      failure: { kind: "min-size", message: "A panel would be smaller than the minimum size.", panelIds: tiny, constraintIds: [] },
    };
  }
  const boxes: Array<{ panelId: string; rect: Rect }> = [];
  for (const panelId of everyone) {
    const frame = placed.frames.get(panelId);
    if (!frame) continue;
    boxes.push({ panelId, rect: frame });
    const bounds = labelBounds(document, panelId, frame);
    if (bounds) boxes.push({ panelId, rect: bounds });
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      if (!a || !b || a.panelId === b.panelId) continue;
      if (intersects(a.rect, b.rect)) {
        return {
          ok: false,
          failure: {
            kind: "overlap",
            message: "Panels or their labels would overlap.",
            panelIds: [a.panelId, b.panelId],
            constraintIds: [],
          },
        };
      }
    }
  }
  let bottom = margins.top;
  for (const box of boxes) bottom = Math.max(bottom, box.rect.y + box.rect.height);
  const needed = bottom + margins.bottom;
  if (prepared.heightMode === "auto") {
    if (needed > document.layoutSettings.maxAutoHeightMm + TOLERANCES.geometryComparisonMm) {
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
  const outside = new Set<string>();
  for (const box of boxes) {
    if (!insideMargins(box.rect, nextCanvas)) outside.add(box.panelId);
  }
  if (outside.size > 0) {
    return {
      ok: false,
      failure: {
        kind: "margin",
        message: "A panel or its label would leave the safety margin.",
        panelIds: [...outside],
        constraintIds: [],
      },
    };
  }
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
  const canvasUnchanged =
    nextCanvas.heightMode === document.canvas.heightMode &&
    nearly(nextCanvas.widthMm, document.canvas.widthMm) &&
    nearly(nextCanvas.heightMm, document.canvas.heightMm);
  if (!canvasUnchanged) commands.push({ type: "canvas.set", canvas: nextCanvas });
  try {
    const previewDocument = applyCommands(document, commands, (assetId) => assetFacts(assets, assetId));
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
      const kind: FailureKind =
        error.code === "LOCKED_ELEMENT" ? "lock" : error.code === "OUTSIDE_CANVAS" ? "margin" : "fit";
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

function assetFacts(assets: Readonly<Record<string, LayoutAssetFacts>>, assetId: string): ReadyAssetFacts | null {
  const facts = assets[assetId];
  if (!facts) return null;
  return {
    id: assetId,
    originalFilename: "asset",
    viewport: facts.viewport,
    rasterPixelSize: facts.rasterPixelSize,
  };
}

function dedupe(candidates: SolvedCandidate[]): SolvedCandidate[] {
  const kept = new Map<string, SolvedCandidate>();
  for (const candidate of candidates) {
    const key = geometryKey(candidate.previewDocument);
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

function prefer(left: SolvedCandidate, right: SolvedCandidate): boolean {
  const leftScore = left.score.total ?? 2;
  const rightScore = right.score.total ?? 2;
  if (leftScore !== rightScore) return leftScore < rightScore;
  const rank = familyRank(left.family) - familyRank(right.family);
  if (rank !== 0) return rank < 0;
  return left.summary < right.summary;
}

function familyRank(family: ConcreteFamily): number {
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
  return {
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
