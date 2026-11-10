import { TOLERANCES, type FigureDocumentV1 } from "@panelstudio/contracts";
import { DocumentCommandError } from "./errors.js";
import type { Rect } from "./labels.js";

type Frame = { x: number; y: number; width: number; height: number };
type Crop = { x: number; y: number; width: number; height: number };
type Viewport = { width: number; height: number };

/** Opposite corner stays fixed. Handbook section 16.4. */
export type FrameAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";

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

export function nearlyEqualMm(a: number, b: number, tolerance = TOLERANCES.geometryComparisonMm): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function framesNearlyEqual(a: Frame, b: Frame, tolerance = TOLERANCES.geometryComparisonMm): boolean {
  return (
    nearlyEqualMm(a.x, b.x, tolerance) &&
    nearlyEqualMm(a.y, b.y, tolerance) &&
    nearlyEqualMm(a.width, b.width, tolerance) &&
    nearlyEqualMm(a.height, b.height, tolerance)
  );
}

export function cropsNearlyEqual(a: Crop, b: Crop): boolean {
  return (
    Math.abs(a.x - b.x) <= CROP_EDGE_EPSILON &&
    Math.abs(a.y - b.y) <= CROP_EDGE_EPSILON &&
    Math.abs(a.width - b.width) <= CROP_EDGE_EPSILON &&
    Math.abs(a.height - b.height) <= CROP_EDGE_EPSILON
  );
}

export function translateFrame(frame: Frame, dx: number, dy: number): Frame {
  return { x: frame.x + dx, y: frame.y + dy, width: frame.width, height: frame.height };
}

/**
 * Uniform scale. One side is specified; the other follows the current frame aspect.
 * The anchor is the corner that does not move.
 */
export function scaleFrame(
  frame: Frame,
  length: { width: number } | { height: number },
  anchor: FrameAnchor,
): Frame {
  const aspect = frame.width / frame.height;
  const width = "width" in length ? length.width : length.height * aspect;
  const height = "height" in length ? length.height : length.width / aspect;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The scaled size must be a positive finite length.");
  }
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  if (anchor === "top-left") return { x: frame.x, y: frame.y, width, height };
  if (anchor === "top-right") return { x: right - width, y: frame.y, width, height };
  if (anchor === "bottom-left") return { x: frame.x, y: bottom - height, width, height };
  return { x: right - width, y: bottom - height, width, height };
}

/**
 * Next visible frame after a crop change. Source content stays put (handbook 6.3).
 * Scale is the frame-width scale, which matches the height scale when aspect holds.
 */
export function frameAfterCrop(frame: Frame, crop: Crop, nextCrop: Crop, viewport: Viewport): Frame {
  const place = contentPlacement(frame, crop, viewport);
  const x = place.x + nextCrop.x * viewport.width * place.scale;
  const y = place.y + nextCrop.y * viewport.height * place.scale;
  const width = nextCrop.width * viewport.width * place.scale;
  const height = nextCrop.height * viewport.height * place.scale;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(width > 0) || !(height > 0)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The crop does not produce a finite frame.");
  }
  return { x, y, width, height };
}

/**
 * Full asset, uniformly fitted inside the old frame, center held.
 * Used by panel.replaceAsset. The crop becomes the full unit square.
 */
export function fitFrameContain(frame: Frame, viewport: Viewport): Frame {
  if (!(viewport.width > 0) || !(viewport.height > 0)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The asset viewport is not usable.");
  }
  const assetAspect = viewport.width / viewport.height;
  const frameAspect = frame.width / frame.height;
  const width = assetAspect >= frameAspect ? frame.width : frame.height * assetAspect;
  const height = assetAspect >= frameAspect ? frame.width / assetAspect : frame.height;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The replacement frame is not finite.");
  }
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
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
