import { TOLERANCES, type FigureDocumentV1 } from "@panelstudio/contracts";
import type { Rect } from "./labels.js";

type Frame = { x: number; y: number; width: number; height: number };
type Crop = { x: number; y: number; width: number; height: number };
type Viewport = { width: number; height: number };

/** Absolute slack for the normalized crop's cross-field unit-square check. */
export const CROP_EDGE_EPSILON = 1e-6;

export function cropIsInsideUnitSquare(crop: Crop): boolean {
  return (
    crop.x >= -CROP_EDGE_EPSILON &&
    crop.y >= -CROP_EDGE_EPSILON &&
    crop.width > 0 &&
    crop.height > 0 &&
    crop.x + crop.width <= 1 + CROP_EDGE_EPSILON &&
    crop.y + crop.height <= 1 + CROP_EDGE_EPSILON
  );
}

export function aspectScales(
  frame: Frame,
  crop: Crop,
  viewport: Viewport,
): { widthScale: number; heightScale: number } {
  return {
    widthScale: frame.width / (viewport.width * crop.width),
    heightScale: frame.height / (viewport.height * crop.height),
  };
}

/** Handbook uniform-scale relative error, 1e-6. */
export function aspectMatches(frame: Frame, crop: Crop, viewport: Viewport): boolean {
  const { widthScale, heightScale } = aspectScales(frame, crop, viewport);
  const denom = Math.max(Math.abs(widthScale), Math.abs(heightScale));
  if (!(denom > 0) || !Number.isFinite(widthScale) || !Number.isFinite(heightScale)) return false;
  return Math.abs(widthScale - heightScale) / denom <= TOLERANCES.uniformScaleRelative;
}

/**
 * Full-asset origin in document millimeters.
 * scale comes from the frame width so the cropped window matches frameMm.width.
 */
export function contentPlacement(
  frame: Frame,
  crop: Crop,
  viewport: Viewport,
): { x: number; y: number; width: number; height: number; scale: number } {
  const scale = frame.width / (viewport.width * crop.width);
  const width = viewport.width * scale;
  const height = viewport.height * scale;
  return {
    x: frame.x - crop.x * width,
    y: frame.y - crop.y * height,
    width,
    height,
    scale,
  };
}

export function rectIsOnCanvas(
  rect: Rect,
  canvas: FigureDocumentV1["canvas"],
  tolerance = TOLERANCES.geometryComparisonMm,
): boolean {
  return (
    rect.x >= -tolerance &&
    rect.y >= -tolerance &&
    rect.x + rect.width <= canvas.widthMm + tolerance &&
    rect.y + rect.height <= canvas.heightMm + tolerance &&
    rect.width > 0 &&
    rect.height > 0
  );
}
