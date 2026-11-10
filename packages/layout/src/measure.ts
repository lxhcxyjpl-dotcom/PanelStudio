import {
  MM_PER_INCH,
  TOLERANCES,
  fontSizePtToSvgUserUnits,
  resolveLabelText,
  type FigureDocumentV1,
  type LayoutRequest,
} from "@panelstudio/contracts";
import { LABEL_EM_ADVANCE, LABEL_EM_ASCENT, LABEL_EM_DESCENT, labelIsVisible } from "@panelstudio/core";

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

/**
 * Label box for a proposed frame.
 * The em box matches the phase 1 label metrics: 0.8 ascent, 0.2 descent, 0.7 advance.
 */
export function labelBounds(document: FigureDocumentV1, panelId: string, frame: Rect): Rect | null {
  const panel = document.panels[panelId];
  if (!panel) return null;
  const style = document.labelStyle;
  const overrides = panel.labelOverrides;
  if (!labelIsVisible(style, overrides)) return null;
  const index = document.panelOrder.indexOf(panelId);
  if (index < 0) return null;
  const text = resolveLabelText({
    index,
    textOverride: overrides.text,
    sequence: style.sequence,
    format: style.format,
  });
  const fontSizePt = overrides.typography?.fontSizePt ?? style.fontSizePt;
  const fontSizeUser = fontSizePtToSvgUserUnits(fontSizePt);
  const placement = overrides.placement ?? style.placement;
  let x = frame.x;
  let y = frame.y;
  if (overrides.offsetMm) {
    x = frame.x + overrides.offsetMm.x;
    y = frame.y + overrides.offsetMm.y;
  } else if (placement === "outside-top-left") {
    y = frame.y - style.gapMm;
  } else {
    x = frame.x + style.gapMm;
    y = frame.y + style.gapMm + fontSizeUser;
  }
  const ascent = fontSizeUser * LABEL_EM_ASCENT;
  const descent = fontSizeUser * LABEL_EM_DESCENT;
  const width = Math.max(1, [...text].length) * fontSizeUser * LABEL_EM_ADVANCE;
  return { x, y: y - ascent, width, height: ascent + descent };
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

export function rasterPpi(
  frameWidthMm: number,
  cropWidth: number,
  rasterWidth: number,
): number | null {
  if (!(frameWidthMm > 0) || !(rasterWidth > 0) || !(cropWidth > 0)) return null;
  const inches = frameWidthMm / MM_PER_INCH;
  if (!(inches > 0)) return null;
  return (rasterWidth * cropWidth) / inches;
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
