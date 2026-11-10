import {
  ENGINE_VERSIONS,
  LAYOUT_SCORE_WEIGHTS,
  type Diagnostic,
  type FigureDocumentV1,
  type LayoutScore,
} from "@panelstudio/contracts";
import { rasterPpi, type LayoutAssetFacts } from "./measure.js";

export type ConcreteFamily = "rows" | "hero-top" | "hero-left";

const PENALTY_KEYS = [
  "readability",
  "whitespace",
  "emphasis",
  "consistency",
  "height",
  "movement",
] as const;

type PenaltyKey = (typeof PENALTY_KEYS)[number];
type Penalty = number | "unknown";

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value > 1) return 1;
  if (value < 0) return 0;
  return value;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Section 7.8 penalties, normalized 0–1, lower is better.
 * Unknown terms are dropped and the remaining handbook weights are renormalized.
 */
export function scoreLayout(
  original: FigureDocumentV1,
  preview: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  family: ConcreteFamily,
  primaryId: string | null,
): { score: LayoutScore; diagnostics: Diagnostic[] } {
  const order = preview.panelOrder;
  const read = readability(preview, assets, order);
  const penalties: Record<PenaltyKey, Penalty> = {
    readability: read.penalty,
    whitespace: whitespace(preview, order),
    emphasis: emphasis(preview, order, family, primaryId),
    consistency: consistency(preview, order, primaryId),
    height: heightPenalty(preview),
    movement: movement(original, preview, order),
  };
  let weightSum = 0;
  let weighted = 0;
  for (const key of PENALTY_KEYS) {
    const penalty = penalties[key];
    if (penalty === "unknown") continue;
    const weight = LAYOUT_SCORE_WEIGHTS[key];
    weightSum += weight;
    weighted += weight * penalty;
  }
  return {
    score: {
      scoringVersion: ENGINE_VERSIONS.layout,
      penalties,
      total: weightSum > 0 ? clamp01(weighted / weightSum) : null,
    },
    diagnostics: read.diagnostics,
  };
}

function readability(
  preview: FigureDocumentV1,
  assets: Readonly<Record<string, LayoutAssetFacts>>,
  order: string[],
): { penalty: Penalty; diagnostics: Diagnostic[] } {
  const target = preview.layoutSettings.targetRasterPpi;
  const shortfalls: number[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const panelId of order) {
    const panel = preview.panels[panelId];
    const pixels = panel ? assets[panel.assetId]?.rasterPixelSize : null;
    if (!panel || !pixels) continue;
    const ppi = rasterPpi(panel.frameMm.width, panel.cropNormalized.width, pixels.width);
    if (ppi === null || !Number.isFinite(ppi)) continue;
    if (ppi + 1e-6 < target) {
      shortfalls.push(clamp01((target - ppi) / target));
      diagnostics.push({
        code: "LAYOUT_PPI_BELOW_TARGET",
        severity: "warning",
        messageKey: "layout.ppiBelowTarget",
        params: { ppi: Math.round(ppi), target },
        panelIds: [panelId],
      });
    } else {
      shortfalls.push(0);
    }
  }
  return {
    penalty: shortfalls.length === 0 ? "unknown" : average(shortfalls),
    diagnostics,
  };
}

function whitespace(preview: FigureDocumentV1, order: string[]): Penalty {
  const canvasArea = preview.canvas.widthMm * preview.canvas.heightMm;
  if (!(canvasArea > 0)) return "unknown";
  let used = 0;
  for (const panelId of order) {
    const frame = preview.panels[panelId]?.frameMm;
    if (!frame) continue;
    used += frame.width * frame.height;
  }
  return clamp01(1 - used / canvasArea);
}

function emphasis(
  preview: FigureDocumentV1,
  order: string[],
  family: ConcreteFamily,
  primaryId: string | null,
): Penalty {
  if (!primaryId) return "unknown";
  const primary = preview.panels[primaryId]?.frameMm;
  if (!primary || order.length === 0) return "unknown";
  let total = 0;
  for (const panelId of order) {
    const frame = preview.panels[panelId]?.frameMm;
    if (frame) total += frame.width * frame.height;
  }
  if (!(total > 0)) return "unknown";
  const share = (primary.width * primary.height) / total;
  const expected = family === "rows" ? 1 / order.length : 0.5;
  if (!(expected > 0)) return "unknown";
  return clamp01(Math.abs(share - expected) / expected);
}

function consistency(preview: FigureDocumentV1, order: string[], primaryId: string | null): Penalty {
  const related = primaryId ? order.filter((panelId) => panelId !== primaryId) : order;
  if (related.length < 2) return "unknown";
  const heights: number[] = [];
  for (const panelId of related) {
    const height = preview.panels[panelId]?.frameMm.height;
    if (height === undefined) return "unknown";
    heights.push(height);
  }
  const maxHeight = Math.max(...heights);
  const minHeight = Math.min(...heights);
  if (!(maxHeight > 0)) return "unknown";
  return clamp01((maxHeight - minHeight) / maxHeight);
}

function heightPenalty(preview: FigureDocumentV1): Penalty {
  const preferred = preview.layoutSettings.preferredHeightMm;
  if (!(preferred > 0)) return "unknown";
  return clamp01(Math.abs(preview.canvas.heightMm - preferred) / preferred);
}

function movement(original: FigureDocumentV1, preview: FigureDocumentV1, order: string[]): Penalty {
  const diagonal = Math.hypot(original.canvas.widthMm, original.canvas.heightMm);
  if (!(diagonal > 0) || order.length === 0) return "unknown";
  const values: number[] = [];
  for (const panelId of order) {
    const before = original.panels[panelId]?.frameMm;
    const after = preview.panels[panelId]?.frameMm;
    if (!before || !after || !(before.width > 0)) return "unknown";
    const move = clamp01(Math.hypot(after.x - before.x, after.y - before.y) / diagonal);
    const scale = clamp01(Math.abs(after.width - before.width) / before.width);
    values.push(clamp01(move * 0.5 + scale * 0.5));
  }
  return average(values);
}
