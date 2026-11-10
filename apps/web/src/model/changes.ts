import type { FigureDocumentV1 } from "@panelstudio/contracts";
import { resolvePanelLabel } from "@panelstudio/core/labels";

export type ProposalChange =
  | { kind: "canvas"; width: number; height: number }
  | { kind: "gutter"; horizontal: number; vertical: number }
  | { kind: "labels" }
  | { kind: "move"; label: string; dx: number; dy: number }
  | { kind: "size"; label: string; before: string; after: string }
  | { kind: "lock"; label: string; locked: boolean }
  | { kind: "text"; label: string; text: string };

export function proposalChanges(base: FigureDocumentV1, preview: FigureDocumentV1): ProposalChange[] {
  const lines: ProposalChange[] = [];
  if (base.canvas.widthMm !== preview.canvas.widthMm || base.canvas.heightMm !== preview.canvas.heightMm) {
    lines.push({ kind: "canvas", width: round(preview.canvas.widthMm), height: round(preview.canvas.heightMm) });
  }
  if (
    base.layoutSettings.gutterMm.horizontal !== preview.layoutSettings.gutterMm.horizontal ||
    base.layoutSettings.gutterMm.vertical !== preview.layoutSettings.gutterMm.vertical
  ) {
    lines.push({
      kind: "gutter",
      horizontal: round(preview.layoutSettings.gutterMm.horizontal),
      vertical: round(preview.layoutSettings.gutterMm.vertical),
    });
  }
  if (JSON.stringify(base.labelStyle) !== JSON.stringify(preview.labelStyle)) lines.push({ kind: "labels" });
  for (const panelId of preview.panelOrder) {
    if (lines.length >= 4) break;
    const before = base.panels[panelId];
    const after = preview.panels[panelId];
    if (!before || !after) continue;
    const label = resolvePanelLabel(base, panelId)?.text ?? before.name;
    if (before.locked !== after.locked) lines.push({ kind: "lock", label, locked: after.locked });
    if (lines.length >= 4) break;
    if (before.labelOverrides.text !== after.labelOverrides.text && after.labelOverrides.text) {
      lines.push({ kind: "text", label, text: after.labelOverrides.text });
    }
    if (lines.length >= 4) break;
    const sameSize = near(before.frameMm.width, after.frameMm.width) && near(before.frameMm.height, after.frameMm.height);
    const samePlace = near(before.frameMm.x, after.frameMm.x) && near(before.frameMm.y, after.frameMm.y);
    if (!sameSize) {
      lines.push({
        kind: "size",
        label,
        before: `${round(before.frameMm.width)}×${round(before.frameMm.height)}`,
        after: `${round(after.frameMm.width)}×${round(after.frameMm.height)}`,
      });
    } else if (!samePlace) {
      lines.push({
        kind: "move",
        label,
        dx: round(after.frameMm.x - before.frameMm.x),
        dy: round(after.frameMm.y - before.frameMm.y),
      });
    }
  }
  return lines.slice(0, 4);
}

function near(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.0001;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
