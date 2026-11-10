import { TOLERANCES, type DomainCommand, type FigureDocumentV1, type SelectionRowLayoutRequest } from "@panelstudio/contracts";
import { DocumentCommandError } from "@panelstudio/core";
import {
  assetFacts, croppedAspect, insideMargins, intersects, occupiedRects, unionRect, unitGeometry,
  type Rect, type Unit,
} from "./measure.js";
import { scoreLayout } from "./score.js";
import type { SolveLayoutFailure, SolveLayoutInput, SolveLayoutResult } from "./solve.js";
import { parseUnitList } from "./units.js";
import { validateCandidateResult } from "./validate.js";

type LocalInput = Omit<SolveLayoutInput, "request"> & { request: SelectionRowLayoutRequest };
type FrameItem = { panelId: string; frameMm: Rect };

function conflict(message: string, details: SolveLayoutFailure["details"]): SolveLayoutFailure {
  return { ok: false, code: "LAYOUT_CONFLICT", message, details };
}

function panelIds(unit: Unit): string[] {
  return unit.kind === "group" ? unit.panelIds : [unit.panelId];
}

function measureUnit(input: LocalInput, unit: Unit, size: number) {
  const { document, request } = input;
  if (request.sizing === "preserve" || unit.kind === "group") return unitGeometry(document, unit);
  const aspect = croppedAspect(document, input.assets, unit.panelId)!;
  return unitGeometry(document, unit, request.sizing === "equal-width" ?
    { width: size, height: size / aspect } : {width: aspect * size, height: size});
}

function buildRow(input: LocalInput, units: Unit[], region: Rect, gap: number, size: number) {
  const measured = units.map((unit) => measureUnit(input, unit, size));
  const topInset = Math.max(...measured.map((u) => -u.occupied.y));
  const requiredHeight = topInset + Math.max(...measured.map((u) => u.occupied.y + u.occupied.height));
  const requiredWidth = measured.reduce((sum, u) => sum + u.occupied.width, gap * (units.length - 1));
  if (requiredHeight > region.height + 1e-10 || requiredWidth > region.width + 1e-10) return null;
  const frames: FrameItem[] = [];
  let left = region.x;
  for (const unit of measured) {
    for (const item of unit.frames) {
      const f = item.frameMm;
      frames.push({ panelId: item.panelId, frameMm: {
        ...f, x: left - unit.occupied.x + f.x, y: region.y + topInset + f.y,
      } });
    }
    left += unit.occupied.width + gap;
  }
  return frames;
}

function maximumRow(input: LocalInput, units: Unit[], region: Rect, gap: number): FrameItem[] | null {
  const { document, request } = input;
  if (request.sizing === "preserve") return buildRow(input, units, region, gap, 0);
  const minimum = document.layoutSettings.minPanelSizeMm;
  const lowerBounds = units.map((unit) => {
    const aspect = croppedAspect(document, input.assets, panelIds(unit)[0]!)!;
    return request.sizing === "equal-width" ? Math.max(minimum.width, minimum.height * aspect)
      : Math.max(minimum.height, minimum.width / aspect);
  });
  let low = Math.max(...lowerBounds);
  let high = request.sizing === "equal-width" ? region.width : region.height;
  let best = buildRow(input, units, region, gap, low);
  if (!best) return null;
  // Each occupied extent is max(content size, fixed ink extent). Only capacity enters the bisection.
  for (let i = 0; i < 52; i++) {
    const mid = (low + high) / 2;
    const frames = buildRow(input, units, region, gap, mid);
    if (frames) { low = mid; best = frames; } else high = mid;
  }
  return best;
}

export function solveLocalRow(input: LocalInput): SolveLayoutResult {
  const { document, request, assets } = input;
  if (request.orderedUnitIds.length < 2 || request.orderedUnitIds.length > 3) {
    return { ok: false, code: "REQUEST_INVALID", message: "Select two or three distinct complete units.", details: { reason: "invalid-units" } };
  }
  const membership = new Map<string, string>();
  for (const [id, group] of Object.entries(document.groups)) {
    for (const member of group.panelIds) membership.set(member, id);
  }
  const selected = new Set<string>();
  const parsed = parseUnitList(document, membership, request.orderedUnitIds, selected);
  if (!parsed.ok) return parsed.failure;
  const units = parsed.units;
  const ids = [...selected];
  for (const id of document.panelOrder) {
    const panel = document.panels[id];
    if (!panel || !assets[panel.assetId]) {
      return { ok: false, code: "DOCUMENT_INVALID", message: "A layout panel has no ready asset.", details: { panelIds: [id] } };
    }
  }
  const locked = ids.filter((id) => document.panels[id]!.locked || document.groups[membership.get(id) ?? ""]?.locked);
  if (locked.length) return { ok: false, code: "LOCKED_ELEMENT", message: "Unlock the selection before arranging it.", details: { panelIds: locked } };
  const groups = units.filter((u) => u.kind === "group");
  if (request.sizing !== "preserve" && groups.length) {
    return conflict("Rigid groups can only use preserve size.", { reason: "group-resize", panelIds: groups.flatMap(panelIds) });
  }
  for (const constraint of document.layoutSettings.constraints) {
    if (constraint.panelIds.some((id) => selected.has(id)) && constraint.panelIds.some((id) => !selected.has(id))) {
      return conflict("Expand the selection or change its cross-selection constraint.", {
        reason: "cross-selection-constraint", constraintIds: [constraint.id], panelIds: constraint.panelIds,
      });
    }
  }
  const boxes = (id: string) => occupiedRects(document, id, document.panels[id]!.frameMm);
  const region = request.regionMm ?? unionRect(ids.flatMap(boxes))!;
  if (!insideMargins(region, document.canvas)) {
    return conflict("The row region must fit inside the canvas margins.", { reason: "region-outside-margins", panelIds: ids });
  }
  const obstacles = document.panelOrder.filter((id) => !selected.has(id) && boxes(id).some((box) => intersects(box, region)));
  if (obstacles.length) return conflict("An unselected panel or label occupies the requested region.", { reason: "region-occupied", panelIds: obstacles });
  const gap = request.gapMm ?? document.layoutSettings.gutterMm.horizontal;
  const items = maximumRow(input, units, region, gap);
  if (!items) return conflict("The region cannot fit the requested sizes, labels and spacing.", { reason: "region-too-small", panelIds: ids });
  const min = document.layoutSettings.minPanelSizeMm;
  const tooSmall = items.filter((f) => f.frameMm.width < min.width - TOLERANCES.geometryComparisonMm || f.frameMm.height < min.height - TOLERANCES.geometryComparisonMm);
  if (tooSmall.length) return conflict("The preserved panels are below the minimum size.", { reason: "layout-min-size", panelIds: tooSmall.map((f) => f.panelId) });
  const commands: DomainCommand[] = [{ type: "panel.setFrames", items }];
  try {
    const previewDocument = validateCandidateResult(document, commands, (id) => assetFacts(assets, id), "layout");
    const scored = scoreLayout(document, previewDocument, assets, "rows", null);
    return { ok: true, candidates: [{ family: "selection-row", summary: "局部单行整理", commands, previewDocument, ...scored }] };
  } catch (error) {
    if (!(error instanceof DocumentCommandError)) throw error;
    const { details } = error;
    if (error.code === "LAYOUT_CONFLICT" && details.panelIds?.length && details.panelIds.every((id) => !selected.has(id))) {
      return conflict("The document has a strict layout conflict outside this selection.", { ...details, reason: "outside-layout-conflict" });
    }
    return { ok: false, code: error.code, message: error.message, details };
  }
}
