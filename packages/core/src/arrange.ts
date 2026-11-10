import type { AlignEdge, DomainCommand, FigureDocumentV1 } from "@panelstudio/contracts";
import { DocumentCommandError } from "./errors.js";
import { scaleFrame, translateFrame, type FrameAnchor } from "./geometry.js";

type Frame = FigureDocumentV1["panels"][string]["frameMm"];

export type ManualAlignReference =
  | { kind: "selection" }
  | { kind: "canvas" }
  | { kind: "panel"; panelId: string }
  | { kind: "group"; groupId: string };

type Unit = { panelIds: string[]; bounds: Frame };

/**
 * Inspector and AI align, compiled to one panel.setFrames.
 * A grouped panel is one rigid unit: every member gets the same translation.
 * The result is not clamped. A frame or label that leaves the canvas fails later.
 */
export function alignSelection(
  document: FigureDocumentV1,
  panelIds: string[],
  edge: AlignEdge,
  reference: ManualAlignReference,
): DomainCommand {
  const units = selectionUnits(document, panelIds);
  const target = referenceBounds(document, reference, units);
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const unit of units) {
    remember(deltas, unit.panelIds, edgeDelta(unit.bounds, edge, target));
  }
  return framesCommand(document, deltas);
}

/**
 * Equal gaps between units. The first and last units on the axis stay put.
 * Two units are a no-op. Grouped panels move together.
 */
export function distributeSelection(
  document: FigureDocumentV1,
  panelIds: string[],
  axis: "horizontal" | "vertical",
): DomainCommand {
  const units = selectionUnits(document, panelIds);
  if (units.length < 2) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "Distribute needs at least two separate objects.");
  }
  const sorted = [...units].sort((left, right) => {
    const delta = axisStart(left.bounds, axis) - axisStart(right.bounds, axis);
    if (Math.abs(delta) > 1e-9) return delta;
    return (left.panelIds[0] ?? "").localeCompare(right.panelIds[0] ?? "");
  });
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "Distribute needs at least two separate objects.");
  }
  const span = axisEnd(last.bounds, axis) - axisStart(first.bounds, axis);
  const content = sorted.reduce((sum, unit) => sum + axisSize(unit.bounds, axis), 0);
  const gap = (span - content) / (sorted.length - 1);
  let cursor = axisStart(first.bounds, axis);
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const unit of sorted) {
    const shift = cursor - axisStart(unit.bounds, axis);
    remember(deltas, unit.panelIds, axis === "horizontal" ? { dx: shift, dy: 0 } : { dx: 0, dy: shift });
    cursor += axisSize(unit.bounds, axis) + gap;
  }
  return framesCommand(document, deltas);
}

/**
 * Equal width or equal height, compiled to one panel.setFrames.
 * The reference is the earliest panelOrder id. Its frame stays.
 * Other frames keep their top-left corner. The unspecified side follows
 * the current frame aspect, so the crop aspect does not change.
 * There is no equal-height command.
 */
export function equalSizeSelection(
  document: FigureDocumentV1,
  panelIds: string[],
  axis: "width" | "height",
): DomainCommand {
  const ids = uniqueExisting(document, panelIds);
  if (ids.length < 2) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "Equal size needs at least two panels.");
  }
  const referenceId = [...ids].sort(
    (left, right) => document.panelOrder.indexOf(left) - document.panelOrder.indexOf(right),
  )[0];
  if (!referenceId) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "Equal size needs at least two panels.");
  }
  const reference = frameOf(document, referenceId);
  return {
    type: "panel.setFrames",
    items: ids.map((panelId) => {
      const frame = frameOf(document, panelId);
      if (panelId === referenceId) return { panelId, frameMm: { ...frame } };
      if (axis === "height") {
        const height = reference.height;
        return { panelId, frameMm: { x: frame.x, y: frame.y, width: frame.width * (height / frame.height), height } };
      }
      const width = reference.width;
      return { panelId, frameMm: { x: frame.x, y: frame.y, width, height: frame.height * (width / frame.width) } };
    }),
  };
}

/** Drag, or an arrow-key nudge, as one translation. Grouped panels move together. */
export function translateSelection(
  document: FigureDocumentV1,
  panelIds: string[],
  dx: number,
  dy: number,
): DomainCommand {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The translation must be finite.");
  }
  const units = selectionUnits(document, panelIds);
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const unit of units) remember(deltas, unit.panelIds, { dx, dy });
  return framesCommand(document, deltas);
}

/** Proportional scale of one panel. The anchor is the corner that stays fixed. */
export function scalePanel(
  document: FigureDocumentV1,
  panelId: string,
  length: { width: number } | { height: number },
  anchor: FrameAnchor,
): DomainCommand {
  const panel = document.panels[panelId];
  if (!panel) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", { panelIds: [panelId] });
  }
  return {
    type: "panel.setFrames",
    items: [{ panelId, frameMm: scaleFrame(panel.frameMm, length, anchor) }],
  };
}

function selectionUnits(document: FigureDocumentV1, panelIds: string[]): Unit[] {
  const ids = uniqueExisting(document, panelIds);
  const units: Unit[] = [];
  const seenGroups = new Set<string>();
  for (const panelId of ids) {
    const group = findGroup(document, panelId);
    if (group) {
      if (seenGroups.has(group.id)) continue;
      seenGroups.add(group.id);
      units.push({ panelIds: [...group.group.panelIds], bounds: boundsOf(document, group.group.panelIds) });
      continue;
    }
    units.push({ panelIds: [panelId], bounds: { ...frameOf(document, panelId) } });
  }
  return units;
}

function referenceBounds(document: FigureDocumentV1, reference: ManualAlignReference, units: Unit[]): Frame {
  if (reference.kind === "canvas") {
    return { x: 0, y: 0, width: document.canvas.widthMm, height: document.canvas.heightMm };
  }
  if (reference.kind === "selection") return unionBounds(units.map((unit) => unit.bounds));
  if (reference.kind === "group") {
    const group = document.groups[reference.groupId];
    if (!group) throw new DocumentCommandError("DOCUMENT_INVALID", "The group does not exist.");
    return boundsOf(document, group.panelIds);
  }
  const panel = document.panels[reference.panelId];
  if (!panel) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", {
      panelIds: [reference.panelId],
    });
  }
  const group = findGroup(document, reference.panelId);
  if (group) return boundsOf(document, group.group.panelIds);
  return { ...panel.frameMm };
}

function edgeDelta(bounds: Frame, edge: AlignEdge, target: Frame): { dx: number; dy: number } {
  if (edge === "left") return { dx: target.x - bounds.x, dy: 0 };
  if (edge === "right") return { dx: target.x + target.width - (bounds.x + bounds.width), dy: 0 };
  if (edge === "top") return { dx: 0, dy: target.y - bounds.y };
  if (edge === "bottom") return { dx: 0, dy: target.y + target.height - (bounds.y + bounds.height) };
  if (edge === "centerX") {
    return { dx: target.x + target.width / 2 - (bounds.x + bounds.width / 2), dy: 0 };
  }
  return { dx: 0, dy: target.y + target.height / 2 - (bounds.y + bounds.height / 2) };
}

function framesCommand(
  document: FigureDocumentV1,
  deltas: Map<string, { dx: number; dy: number }>,
): DomainCommand {
  if (deltas.size === 0) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The edit does not name a panel.");
  }
  return {
    type: "panel.setFrames",
    items: [...deltas].map(([panelId, delta]) => ({
      panelId,
      frameMm: translateFrame(frameOf(document, panelId), delta.dx, delta.dy),
    })),
  };
}

function remember(
  deltas: Map<string, { dx: number; dy: number }>,
  panelIds: string[],
  delta: { dx: number; dy: number },
): void {
  for (const panelId of panelIds) {
    const existing = deltas.get(panelId);
    if (existing && (existing.dx !== delta.dx || existing.dy !== delta.dy)) {
      throw new DocumentCommandError("DOCUMENT_INVALID", "A panel was moved twice.", { panelIds: [panelId] });
    }
    deltas.set(panelId, delta);
  }
}

function uniqueExisting(document: FigureDocumentV1, panelIds: string[]): string[] {
  if (panelIds.length === 0) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The edit does not name a panel.");
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const panelId of panelIds) {
    if (!document.panels[panelId]) {
      throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", { panelIds: [panelId] });
    }
    if (seen.has(panelId)) continue;
    seen.add(panelId);
    ids.push(panelId);
  }
  return ids;
}

function findGroup(document: FigureDocumentV1, panelId: string): { id: string; group: FigureDocumentV1["groups"][string] } | null {
  for (const [id, group] of Object.entries(document.groups)) {
    if (group.panelIds.includes(panelId)) return { id, group };
  }
  return null;
}

function frameOf(document: FigureDocumentV1, panelId: string): Frame {
  const panel = document.panels[panelId];
  if (!panel) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", { panelIds: [panelId] });
  }
  return panel.frameMm;
}

function boundsOf(document: FigureDocumentV1, panelIds: string[]): Frame {
  return unionBounds(panelIds.map((panelId) => frameOf(document, panelId)));
}

function unionBounds(frames: Frame[]): Frame {
  const x = Math.min(...frames.map((frame) => frame.x));
  const y = Math.min(...frames.map((frame) => frame.y));
  const right = Math.max(...frames.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height));
  return { x, y, width: right - x, height: bottom - y };
}

function axisStart(frame: Frame, axis: "horizontal" | "vertical"): number {
  return axis === "horizontal" ? frame.x : frame.y;
}

function axisSize(frame: Frame, axis: "horizontal" | "vertical"): number {
  return axis === "horizontal" ? frame.width : frame.height;
}

function axisEnd(frame: Frame, axis: "horizontal" | "vertical"): number {
  return axisStart(frame, axis) + axisSize(frame, axis);
}
