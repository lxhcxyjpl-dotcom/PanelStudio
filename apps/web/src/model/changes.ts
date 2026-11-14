import { resolveLabelText, type FigureDocumentV1 } from "@panelstudio/contracts";

export type ProposalChange =
  | { kind: "canvas"; width: number; height: number }
  | { kind: "gutter"; horizontal: number; vertical: number }
  | { kind: "labels" | "canvasSettings" | "layoutSettings" }
  | { kind: "move"; label: string; dx: number; dy: number; beforeX: number; afterX: number; beforeY: number; afterY: number }
  | { kind: "size"; label: string; before: string; after: string }
  | { kind: "lock"; label: string; locked: boolean }
  | { kind: "text"; label: string; text: string }
  | { kind: "style" | "labelPosition" | "labelVisibility" | "crop"; label: string }
  | { kind: "labelSize"; label?: string; before: number; after: number }
  | { kind: "labelColor"; label?: string; before: string; after: string }
  | { kind: "order" };

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
  if (base.labelStyle.fontSizePt !== preview.labelStyle.fontSizePt) lines.push({ kind: "labelSize", before: base.labelStyle.fontSizePt, after: preview.labelStyle.fontSizePt });
  if (base.labelStyle.color !== preview.labelStyle.color) lines.push({ kind: "labelColor", before: base.labelStyle.color, after: preview.labelStyle.color });
  if (changed({ ...base.labelStyle, fontSizePt: 0, color: "" }, { ...preview.labelStyle, fontSizePt: 0, color: "" })) lines.push({ kind: "labels" });
  if (changed(base.stackOrder, preview.stackOrder) || changed(base.panelOrder, preview.panelOrder)) lines.push({ kind: "order" });
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
    if (changed(prev.typography, next.typography)) {
      const a = { ...base.labelStyle, ...prev.typography }, b = { ...preview.labelStyle, ...next.typography };
      if (a.fontSizePt !== b.fontSizePt) lines.push({ kind: "labelSize", label, before: a.fontSizePt, after: b.fontSizePt });
      if (a.color !== b.color) lines.push({ kind: "labelColor", label, before: a.color, after: b.color });
      if (a.fontId !== b.fontId || a.fontWeight !== b.fontWeight) lines.push({ kind: "style", label });
    }
    if (changed(before.cropNormalized, after.cropNormalized)) lines.push({ kind: "crop", label });
    if (changed(prev.offsetMm, next.offsetMm) || prev.placement !== next.placement) lines.push({ kind: "labelPosition", label });
    if (prev.visible !== next.visible) lines.push({ kind: "labelVisibility", label });
    const a = before.frameMm, b = after.frameMm;
    if (Math.abs(a.width - b.width) > 0.0001 || Math.abs(a.height - b.height) > 0.0001)
      lines.push({ kind: "size", label, before: `${round(a.width)}×${round(a.height)}`, after: `${round(b.width)}×${round(b.height)}` });
    if (Math.abs(a.x - b.x) > 0.0001 || Math.abs(a.y - b.y) > 0.0001)
      lines.push({ kind: "move", label, dx: round(b.x - a.x), dy: round(b.y - a.y), beforeX: round(a.x), afterX: round(b.x), beforeY: round(a.y), afterY: round(b.y) });
  }
  return lines;
}
export function unchangedPanelCount(base: FigureDocumentV1, preview: FigureDocumentV1): number {
  if (JSON.stringify(base.labelStyle) !== JSON.stringify(preview.labelStyle) || JSON.stringify(base.groups) !== JSON.stringify(preview.groups)) return 0;
  return base.panelOrder.filter(id => JSON.stringify(base.panels[id]) === JSON.stringify(preview.panels[id]) && labelName(base, id) === labelName(preview, id)).length;
}
function round(n: number) { return Math.round(n * 100) / 100; }
