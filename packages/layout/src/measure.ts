import {
  TOLERANCES,
  type FigureDocumentV1,
  type LayoutRequest,
} from "@panelstudio/contracts";
import { resolvePanelLabel, type ReadyAssetFacts } from "@panelstudio/core";

export type Rect = { x: number; y: number; width: number; height: number };

export type PanelUnit = { kind: "panel"; panelId: string };
export type GroupUnit = { kind: "group"; groupId: string; panelIds: string[] };
export type Unit = PanelUnit | GroupUnit;

export type LayoutAssetFacts = {
  viewport: { width: number; height: number };
  rasterPixelSize: { width: number; height: number } | null;
};

const PANEL_UNIT = /^panel:([0-9a-fA-F-]{36})$/u;
const GROUP_UNIT = /^group:([0-9a-fA-F-]{36})$/u;

export function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCES.geometryComparisonMm;
}

export function unionRect(rects: Rect[]): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX) || !(maxX > minX) || !(maxY > minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function intersects(a: Rect, b: Rect): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlapX > TOLERANCES.geometryComparisonMm && overlapY > TOLERANCES.geometryComparisonMm;
}

export function insideMargins(rect: Rect, canvas: FigureDocumentV1["canvas"]): boolean {
  const margins = canvas.marginsMm;
  return (
    rect.x >= margins.left - TOLERANCES.geometryComparisonMm &&
    rect.y >= margins.top - TOLERANCES.geometryComparisonMm &&
    rect.x + rect.width <= canvas.widthMm - margins.right + TOLERANCES.geometryComparisonMm &&
    rect.y + rect.height <= canvas.heightMm - margins.bottom + TOLERANCES.geometryComparisonMm
  );
}

/** Ink on the proposed frame, in document coordinates. Strict layout validates unmeasurable labels. */
export function labelBounds(document: FigureDocumentV1, panelId: string, frame: Rect): Rect | null {
  return resolvePanelLabel(document, panelId, frame)?.bounds ?? null;
}

export function occupiedRects(document: FigureDocumentV1, panelId: string, frame: Rect): Rect[] {
  const ink = labelBounds(document, panelId, frame);
  return ink ? [frame, ink] : [frame];
}

/** Space the outside label needs above this panel's current frame. Translation-invariant. */
export function labelTopInset(document: FigureDocumentV1, panelId: string): number {
  const frame = document.panels[panelId]?.frameMm;
  if (!frame) return 0;
  const bounds = labelBounds(document, panelId, frame);
  if (!bounds) return 0;
  return Math.max(0, frame.y - bounds.y);
}

export function unitTopInset(document: FigureDocumentV1, unit: Unit): number {
  if (unit.kind === "panel") return labelTopInset(document, unit.panelId);
  const frames = framesOf(document, unit.panelIds);
  const box = unionRect(frames);
  if (!box) return 0;
  let inset = 0;
  for (const panelId of unit.panelIds) {
    const frame = document.panels[panelId]?.frameMm;
    if (!frame) continue;
    const bounds = labelBounds(document, panelId, frame);
    if (!bounds) continue;
    inset = Math.max(inset, box.y - bounds.y);
  }
  return Math.max(0, inset);
}

export function framesOf(document: FigureDocumentV1, panelIds: string[]): Rect[] {
  const frames: Rect[] = [];
  for (const panelId of panelIds) {
    const frame = document.panels[panelId]?.frameMm;
    if (frame) frames.push(frame);
  }
  return frames;
}

export function unitContentBox(document: FigureDocumentV1, unit: Unit): Rect | null {
  if (unit.kind === "panel") {
    const frame = document.panels[unit.panelId]?.frameMm;
    return frame ? { ...frame } : null;
  }
  return unionRect(framesOf(document, unit.panelIds));
}

/** Ink and content relative to the common content top-left; rigid-group members retain their spacing. */
export function unitGeometry(document: FigureDocumentV1, unit: Unit, size?: {width: number; height: number}) {
  const content = unitContentBox(document, unit)!;
  const ids = unit.kind === "group" ? unit.panelIds : [unit.panelId];
  const frames = ids.map((panelId) => {
    const f = document.panels[panelId]!.frameMm;
    return { panelId, frameMm: { x: f.x - content.x, y: f.y - content.y,
      width: size?.width ?? f.width, height: size?.height ?? f.height } };
  });
  // Zero dimensions are used only for measuring the limiting width during a capacity search.
  const occupied = unionRect(frames.flatMap((item) => occupiedRects(document, item.panelId, item.frameMm))) ??
    { x: 0, y: 0, width: 0, height: 0 };
  return { frames, occupied };
}

export function croppedAspect(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  panelId: string,
): number | null {
  const panel = document.panels[panelId];
  if (!panel) return null;
  const asset = assets[panel.assetId];
  if (!asset) return null;
  const width = asset.viewport.width * panel.cropNormalized.width;
  const height = asset.viewport.height * panel.cropNormalized.height;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return width / height;
}

export function parseUnitId(value: string): { kind: "panel" | "group"; id: string } | null {
  const panel = PANEL_UNIT.exec(value);
  if (panel?.[1]) return { kind: "panel", id: panel[1] };
  const group = GROUP_UNIT.exec(value);
  if (group?.[1]) return { kind: "group", id: group[1] };
  return null;
}

export function hasExplicitRows(request: LayoutRequest): request is LayoutRequest & { rows: string[][] } {
  return "rows" in request && Array.isArray(request.rows);
}

export function hasExplicitOrder(request: LayoutRequest): request is LayoutRequest & { orderedUnitIds: string[] } {
  return "orderedUnitIds" in request && Array.isArray(request.orderedUnitIds);
}

export function compositions(count: number): number[][] {
  const found: number[][] = [];
  const walk = (remaining: number, prefix: number[]): void => {
    if (remaining === 0) {
      found.push(prefix);
      return;
    }
    const max = Math.min(3, remaining);
    for (let size = 1; size <= max; size += 1) walk(remaining - size, [...prefix, size]);
  };
  if (count === 0) return [[]];
  walk(count, []);
  return found;
}

export function splitUnits(units: Unit[], pattern: number[]): Unit[][] {
  const rows: Unit[][] = [];
  let index = 0;
  for (const size of pattern) {
    rows.push(units.slice(index, index + size));
    index += size;
  }
  return rows;
}

export function patternKey(rows: Unit[][]): string {
  return rows.map((row) => String(row.length)).join("-");
}

export function assetFacts(assets: Readonly<Record<string, LayoutAssetFacts>>, assetId: string): ReadyAssetFacts | null {
  const facts = assets[assetId];
  if (!facts) return null;
  return {
    id: assetId,
    originalFilename: "asset",
    viewport: facts.viewport,
    rasterPixelSize: facts.rasterPixelSize,
  };
}
