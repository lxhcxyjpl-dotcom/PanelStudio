import { TOLERANCES, type FigureDocumentV1 } from "@panelstudio/contracts";
import {
  croppedAspect,
  labelBounds,
  unitContentBox,
  unitTopInset,
  type LayoutAssetFacts,
  type Rect,
  type Unit,
} from "./measure.js";

export type Placement = {
  frames: Map<string, Rect>;
  bottom: number;
};

/**
 * Continuous rows in a column of `width`, starting at `(originX, originY)`.
 * Origin Y is the top of the margin box. The first row's outside labels sit in that box.
 * Later rows keep at least the vertical gutter, and more when the next label needs it.
 * Groups keep their current size and are only translated.
 */
export function placeStack(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  rows: Unit[][],
  originX: number,
  originY: number,
  width: number,
  gutterH: number,
  gutterV: number,
): Placement | null {
  if (!(width > 0) || rows.length === 0) return null;
  const frames = new Map<string, Rect>();
  let previousBottom = originY;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.length === 0 || row.length > 3) return null;
    const headroom = row.reduce((max, unit) => Math.max(max, unitTopInset(document, unit)), 0);
    const contentY = index === 0 ? originY + headroom : previousBottom + Math.max(gutterV, headroom);
    const placed = placeRow(document, assets, row, contentY, originX, width, gutterH);
    if (!placed) return null;
    let bottom = contentY;
    for (const [panelId, frame] of placed) {
      frames.set(panelId, frame);
      bottom = Math.max(bottom, frame.y + frame.height);
      const bounds = labelBounds(document, panelId, frame);
      if (bounds) bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    previousBottom = bottom;
  }
  if (frames.size === 0) return null;
  return { frames, bottom: previousBottom };
}

function placeRow(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  row: Unit[],
  contentY: number,
  left: number,
  width: number,
  gutterH: number,
): Map<string, Rect> | null {
  const gaps = (row.length - 1) * gutterH;
  let fixed = 0;
  let aspectSum = 0;
  const aspects = new Map<string, number>();
  for (const unit of row) {
    if (unit.kind === "group") {
      const box = unitContentBox(document, unit);
      if (!box) return null;
      fixed += box.width;
      continue;
    }
    const aspect = croppedAspect(document, assets, unit.panelId);
    if (aspect === null) return null;
    aspectSum += aspect;
    aspects.set(unit.panelId, aspect);
  }
  const remaining = width - gaps - fixed;
  const scalable = aspects.size;
  if (scalable === 0) {
    if (fixed + gaps > width + TOLERANCES.geometryComparisonMm) return null;
  } else if (!(remaining > 0) || !(aspectSum > 0)) {
    return null;
  }
  const sharedHeight = scalable > 0 ? remaining / aspectSum : 0;
  const frames = new Map<string, Rect>();
  let x = left;
  for (const unit of row) {
    if (unit.kind === "group") {
      const box = unitContentBox(document, unit);
      if (!box) return null;
      const dx = x - box.x;
      const dy = contentY - box.y;
      for (const panelId of unit.panelIds) {
        const current = document.panels[panelId]?.frameMm;
        if (!current) return null;
        frames.set(panelId, {
          x: current.x + dx,
          y: current.y + dy,
          width: current.width,
          height: current.height,
        });
      }
      x += box.width + gutterH;
      continue;
    }
    const aspect = aspects.get(unit.panelId);
    if (aspect === undefined) return null;
    const frameWidth = aspect * sharedHeight;
    const frameHeight = frameWidth / aspect;
    if (!(frameWidth > 0) || !(frameHeight > 0)) return null;
    frames.set(unit.panelId, { x, y: contentY, width: frameWidth, height: frameHeight });
    x += frameWidth + gutterH;
  }
  if (x - gutterH > left + width + TOLERANCES.geometryComparisonMm) return null;
  return frames;
}

const SEARCH_ITERATIONS = 64;
const SEARCH_EDGE_MM = 0.01;

export type HeroLeftPlacement = Placement & {
  leftHeight: number;
  rightHeight: number;
};

/**
 * Primary on the left, secondary rows on the right.
 * Column width is the root of leftHeight(q) - rightHeight(q), found by bisection.
 * Both columns start at the same top. Groups on the right stay rigid, so the
 * right-hand height is only weakly increasing; bisection still finds the crossing.
 */
export function placeHeroLeft(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  primaryId: string,
  secondaryRows: Unit[][],
  originX: number,
  originY: number,
  innerWidth: number,
  gutterH: number,
  gutterV: number,
): HeroLeftPlacement | null {
  if (secondaryRows.length === 0 || !(innerWidth > gutterH + SEARCH_EDGE_MM * 2)) return null;
  const minimums = secondaryRows.map((row) => minimumRowWidth(document, row, gutterH));
  const qMin = Math.max(SEARCH_EDGE_MM, ...minimums);
  const qMax = innerWidth - gutterH - SEARCH_EDGE_MM;
  if (!(qMax > qMin)) return null;

  const measure = (columnWidth: number): HeroLeftPlacement | null => {
    const primaryWidth = innerWidth - gutterH - columnWidth;
    if (!(primaryWidth > 0) || !(columnWidth > 0)) return null;
    const left = placeStack(
      document,
      assets,
      [[{ kind: "panel", panelId: primaryId }]],
      originX,
      originY,
      primaryWidth,
      gutterH,
      gutterV,
    );
    const right = placeStack(
      document,
      assets,
      secondaryRows,
      originX + primaryWidth + gutterH,
      originY,
      columnWidth,
      gutterH,
      gutterV,
    );
    if (!left || !right) return null;
    const frames = new Map<string, Rect>([...left.frames, ...right.frames]);
    return {
      frames,
      bottom: Math.max(left.bottom, right.bottom),
      leftHeight: left.bottom - originY,
      rightHeight: right.bottom - originY,
    };
  };

  const atMin = measure(qMin);
  const atMax = measure(qMax);
  if (!atMin || !atMax) return null;
  const difference = (placement: HeroLeftPlacement) => placement.leftHeight - placement.rightHeight;
  const lowDiff = difference(atMin);
  const highDiff = difference(atMax);
  if (lowDiff > TOLERANCES.geometryComparisonMm && highDiff > TOLERANCES.geometryComparisonMm) return null;
  if (lowDiff < -TOLERANCES.geometryComparisonMm && highDiff < -TOLERANCES.geometryComparisonMm) return null;

  let lo = qMin;
  let hi = qMax;
  let best = Math.abs(lowDiff) <= Math.abs(highDiff) ? atMin : atMax;
  for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration += 1) {
    const mid = (lo + hi) / 2;
    const placed = measure(mid);
    if (!placed) return null;
    const diff = difference(placed);
    if (Math.abs(diff) < Math.abs(difference(best))) best = placed;
    if (Math.abs(diff) <= TOLERANCES.geometryComparisonMm) {
      best = placed;
      break;
    }
    if (diff > 0) lo = mid;
    else hi = mid;
  }
  if (Math.abs(difference(best)) > TOLERANCES.geometryComparisonMm) return null;
  return best;
}

function minimumRowWidth(document: FigureDocumentV1, row: Unit[], gutterH: number): number {
  const gaps = (row.length - 1) * gutterH;
  let fixed = 0;
  let scalable = 0;
  for (const unit of row) {
    if (unit.kind === "group") {
      const box = unitContentBox(document, unit);
      fixed += box?.width ?? 0;
    } else {
      scalable += 1;
    }
  }
  if (scalable === 0) return fixed + gaps;
  return fixed + gaps + SEARCH_EDGE_MM;
}
