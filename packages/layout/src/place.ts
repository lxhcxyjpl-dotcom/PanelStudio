import { TOLERANCES, type FigureDocumentV1 } from "@panelstudio/contracts";
import {
  MAX_AUTO_ROW_UNITS,
  MIN_WIDE_PANEL_ASPECT,
  croppedAspect,
  labelBounds,
  unitGeometry,
  unitTopInset,
  type LayoutAssetFacts,
  type Rect,
  type Unit,
} from "./measure.js";

export type Placement = {
  frames: Map<string, Rect>;
  bottom: number;
};

type HorizontalAlignment = { leftPadding: number; rightExtent: number };
type RowLimit = { height: number; alignment?: HorizontalAlignment };

export type RowEmphasis = { minimumWidthMm: number; alignedRows: number[][] };

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
  commonFirstInset = 0,
  rowLimits?: ReadonlyMap<number, RowLimit>,
): Placement | null {
  if (!(width > 0) || rows.length === 0) return null;
  const frames = new Map<string, Rect>();
  let previousBottom = originY;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.length === 0 || row.length > MAX_AUTO_ROW_UNITS) return null;
    const headroom = row.reduce((max, unit) => Math.max(max, unitTopInset(document, unit)), index === 0 ? commonFirstInset : 0);
    const contentY = index === 0 ? originY + headroom : previousBottom + Math.max(gutterV, headroom);
    const placed = placeRow(document, assets, row, contentY, originX, width, gutterH, rowLimits?.get(index));
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
  limit?: RowLimit,
): Map<string, Rect> | null {
  const gaps = (row.length - 1) * gutterH;
  let fixed = 0, aspectSum = 0;
  const aspects = new Map<string, number>();
  for (const unit of row) {
    if (unit.kind === "group") {
      fixed += unitGeometry(document, unit).occupied.width;
    } else {
      const aspect = croppedAspect(document, assets, unit.panelId);
      if (aspect === null) return null;
      aspectSum += aspect;
      aspects.set(unit.panelId, aspect);
    }
  }
  const remaining = width - gaps - fixed;
  if (remaining < -TOLERANCES.geometryComparisonMm || (aspectSum > 0 && remaining <= 0)) return null;
  const measure = (height: number) => row.map((unit) => unitGeometry(document, unit,
    unit.kind === "panel" ? {width: aspects.get(unit.panelId)! * height, height} : undefined));
  const capacity = (shapes: ReturnType<typeof measure>) => shapes.reduce((sum, u) => sum + u.occupied.width, gaps);
  const upper = aspectSum === 0 ? 0 : Math.min(remaining / aspectSum, limit?.height ?? Infinity);
  let shapes = measure(upper);
  if (capacity(shapes) > width + TOLERANCES.geometryComparisonMm) {
    if (aspectSum === 0 || capacity(measure(0)) > width + TOLERANCES.geometryComparisonMm) return null;
    let low = 0, high = upper;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      if (capacity(measure(mid)) <= width) low = mid;
      else high = mid;
    }
    if (low <= 0) return null;
    shapes = measure(low);
  }
  let leftEdge = limit === undefined ? left : left + Math.max(0, (width - capacity(shapes)) / 2);
  if (limit?.alignment) {
    const shape = shapes[0]!;
    const panelWidth = shape.frames[0]!.frameMm.width;
    const desiredX = Math.max(limit.alignment.leftPadding, (width - panelWidth) / 2);
    const maximumX = width - Math.max(panelWidth, limit.alignment.rightExtent);
    leftEdge = left + Math.min(desiredX, maximumX) + shape.occupied.x;
  }
  const frames = new Map<string, Rect>();
  for (const unit of shapes) {
    for (const item of unit.frames) {
      const f = item.frameMm;
      frames.set(item.panelId, { ...f, x: leftEdge - unit.occupied.x + f.x, y: contentY + f.y });
    }
    leftEdge += unit.occupied.width + gutterH;
  }
  return frames;
}

type RowSizeRange = { index: number; full: number; minimum: number };

/**
 * Fits explicit rows by shortening isolated panels first, then their comparison
 * rows. Keep paired panels at the same height and keep a stronger size floor
 * for wide plots, where axis labels are often already small at full row width.
 */
export function placeCompactStack(
  document: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  rows: Unit[][],
  originX: number,
  originY: number,
  width: number,
  gutterH: number,
  gutterV: number,
  bottomLimit: number,
  primaryId: string | null,
  emphasis?: RowEmphasis,
): Placement | null {
  const place = (limits?: ReadonlyMap<number, RowLimit>) =>
    placeStack(document, assets, rows, originX, originY, width, gutterH, gutterV, 0, limits);
  const tolerance = TOLERANCES.geometryComparisonMm;
  const minimum = document.layoutSettings.minPanelSizeMm;
  const limits = new Map<number, RowLimit>();
  const aligned: RowSizeRange[] = [];
  const primary: RowSizeRange[] = [];
  for (const group of emphasis?.alignedRows ?? []) {
    const panels = group.map(index => rows[index]![0]!);
    const aspects = panels.map(panel => panel.kind === "panel" && croppedAspect(document, assets, panel.panelId));
    if (!aspects.every((aspect): aspect is number => typeof aspect === "number")) return null;
    const ink = panels.map(panel => unitGeometry(document, panel, { width: 0, height: 0 }).occupied);
    const alignment = {
      leftPadding: Math.max(0, ...ink.map(box => -box.x)),
      rightExtent: Math.max(0, ...ink.map(box => box.x + box.width)),
    };
    const fullWidth = width - alignment.leftPadding;
    if (fullWidth <= 0 || alignment.rightExtent > fullWidth + tolerance) return null;
    const isPrimary = panels.some(panel => panel.kind === "panel" && panel.panelId === primaryId);
    const minWidth = Math.max(fullWidth * 0.9, minimum.width, ...aspects.map(aspect => minimum.height * aspect),
      isPrimary ? emphasis!.minimumWidthMm : 0);
    for (const [position, index] of group.entries()) {
      const aspect = aspects[position]!;
      const full = fullWidth / aspect;
      limits.set(index, { height: full, alignment });
      if (fullWidth > minWidth + tolerance) {
        (isPrimary ? primary : aligned).push({ index, full, minimum: minWidth / aspect });
      }
    }
  }
  const full = place(limits);
  if (!full || full.bottom <= bottomLimit + tolerance) return full;

  const single: RowSizeRange[] = [];
  const paired: RowSizeRange[] = [];
  for (const [index, row] of rows.entries()) {
    if (limits.has(index) || !row.every(unit => unit.kind === "panel")) continue;
    const primaryIndex = row.findIndex(unit => unit.panelId === primaryId);
    if (primaryIndex >= 0 && !emphasis) continue;
    const frames = row.map(unit => full.frames.get(unit.panelId)!);
    const fullHeight = frames[0]!.height;
    const aspects = frames.map(frame => frame.width / frame.height);
    const floor = aspects.some(aspect => aspect >= MIN_WIDE_PANEL_ASPECT) ? 0.9 : row.length === 1 ? 0.5 : 0.8;
    const focusHeight = emphasis && primaryIndex >= 0 ? emphasis.minimumWidthMm / aspects[primaryIndex]! : 0;
    const minHeight = Math.max(fullHeight * floor, minimum.height, focusHeight, ...aspects.map(aspect => minimum.width / aspect));
    if (minHeight + tolerance < fullHeight) {
      (primaryIndex >= 0 ? primary : row.length === 1 ? single : paired).push({index, full: fullHeight, minimum: minHeight});
    }
  }

  for (const cohort of [single, paired, aligned, primary]) {
    if (!cohort.length) continue;
    const fitAt = (fraction: number) => {
      for (const {index, full, minimum} of cohort) {
        limits.set(index, { ...limits.get(index), height: full + (minimum - full) * fraction });
      }
      return place(limits);
    };
    const tightest = fitAt(1);
    if (!tightest || tightest.bottom > bottomLimit + tolerance) continue;
    let best = tightest;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2;
      const trial = fitAt(mid);
      if (trial && trial.bottom <= bottomLimit) {
        best = trial;
        high = mid;
      } else low = mid;
    }
    return best;
  }
  // Keep the normal height diagnostic when no readable arrangement fits.
  return full;
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
  const hero: Unit = { kind: "panel", panelId: primaryId };
  const qMax = innerWidth - gutterH - minimumRowWidth(document, [hero], gutterH);
  if (!(qMax > qMin)) return null;

  const firstInset = Math.max(unitTopInset(document, hero), ...secondaryRows[0]!.map((unit) => unitTopInset(document, unit)));
  const measure = (columnWidth: number): HeroLeftPlacement | null => {
    const primaryWidth = innerWidth - gutterH - columnWidth;
    if (!(primaryWidth > 0) || !(columnWidth > 0)) return null;
    const left = placeStack(
      document,
      assets,
      [[hero]],
      originX,
      originY,
      primaryWidth,
      gutterH,
      gutterV,
      firstInset,
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
      firstInset,
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
  const lower = row.reduce((sum, unit) =>
    sum + unitGeometry(document, unit, unit.kind === "panel" ? {width:0, height:0} : undefined).occupied.width, gaps);
  return lower + (row.some((unit) => unit.kind === "panel") ? SEARCH_EDGE_MM : 0);
}
