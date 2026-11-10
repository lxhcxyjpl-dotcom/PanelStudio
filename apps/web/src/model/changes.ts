import { resolveLabelText, type FigureDocumentV1 } from "@panelstudio/contracts";

export type ProposalChange =
  | { kind: "canvas"; width: number; height: number }
  | { kind: "gutter"; horizontal: number; vertical: number }
  | { kind: "labels" | "canvasSettings" | "layoutSettings" }
  | { kind: "move"; label: string; dx: number; dy: number }
  | { kind: "size"; label: string; before: string; after: string }
  | { kind: "lock"; label: string; locked: boolean }
  | { kind: "text"; label: string; text: string }
  | { kind: "style" | "labelPosition" | "labelVisibility"; label: string };

export function labelName(doc: FigureDocumentV1, id: string) {
  const index = doc.panelOrder.indexOf(id);
  const panel = doc.panels[id];
  if (!panel || index < 0) return "";
  return resolveLabelText({ index, textOverride: panel.labelOverrides.text, format: doc.labelStyle.format, sequence: doc.labelStyle.sequence });
}
export function proposalChanges(base: FigureDocumentV1, preview: FigureDocumentV1): ProposalChange[] {
  const lines: ProposalChange[] = [];
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if (base.canvas.widthMm !== preview.canvas.widthMm || base.canvas.heightMm !== preview.canvas.heightMm)
    lines.push({ kind: "canvas", width: round(preview.canvas.widthMm), height: round(preview.canvas.heightMm) });
  if (changed(base.canvas.marginsMm, preview.canvas.marginsMm) || base.canvas.heightMode !== preview.canvas.heightMode)
    lines.push({ kind: "canvasSettings" });
  if (changed(base.layoutSettings.gutterMm, preview.layoutSettings.gutterMm)) {
    const { horizontal, vertical } = preview.layoutSettings.gutterMm;
    lines.push({ kind: "gutter", horizontal: round(horizontal), vertical: round(vertical) });
  }
  if (changed({ ...base.layoutSettings, gutterMm: null }, { ...preview.layoutSettings, gutterMm: null })) lines.push({ kind: "layoutSettings" });
  if (changed(base.labelStyle, preview.labelStyle)) lines.push({ kind: "labels" });
  for (const [id, group] of Object.entries(preview.groups)) {
    if (base.groups[id]?.locked !== group.locked) lines.push({ kind: "lock", label: group.name, locked: group.locked });
  }
  for (const id of preview.panelOrder) {
    const before = base.panels[id], after = preview.panels[id];
    if (!before || !after) continue;
    const label = labelName(base, id), nextLabel = labelName(preview, id);
    if (label !== nextLabel) lines.push({ kind: "text", label, text: nextLabel });
    if (before.locked !== after.locked) lines.push({ kind: "lock", label, locked: after.locked });
    const prev = before.labelOverrides, next = after.labelOverrides;
    if (changed(prev.typography, next.typography)) lines.push({ kind: "style", label });
    if (changed(prev.offsetMm, next.offsetMm) || prev.placement !== next.placement) lines.push({ kind: "labelPosition", label });
    if (prev.visible !== next.visible) lines.push({ kind: "labelVisibility", label });
    const a = before.frameMm, b = after.frameMm;
    if (Math.abs(a.width - b.width) > 0.0001 || Math.abs(a.height - b.height) > 0.0001)
      lines.push({ kind: "size", label, before: `${round(a.width)}×${round(a.height)}`, after: `${round(b.width)}×${round(b.height)}` });
    if (Math.abs(a.x - b.x) > 0.0001 || Math.abs(a.y - b.y) > 0.0001)
      lines.push({ kind: "move", label, dx: round(b.x - a.x), dy: round(b.y - a.y) });
  }
  return lines;
}
function round(n: number) { return Math.round(n * 100) / 100; }
