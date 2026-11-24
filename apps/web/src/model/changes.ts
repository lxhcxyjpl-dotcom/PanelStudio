import { resolveLabelText, type FigureDocumentV1 } from "@panelstudio/contracts";

type PanelChange = { panelId: string; label: string };

export type ProposalChange =
  | { kind: "canvas"; beforeWidth: number; beforeHeight: number; width: number; height: number }
  | { kind: "gutter"; horizontal: number; vertical: number }
  | { kind: "labels" | "canvasSettings" | "layoutSettings" }
  | (PanelChange & { kind: "move"; dx: number; dy: number; beforeX: number; afterX: number; beforeY: number; afterY: number })
  | (PanelChange & { kind: "size"; before: string; after: string })
  | { kind: "lock"; panelId?: string; label: string; locked: boolean }
  | (PanelChange & { kind: "text"; text: string })
  | (PanelChange & { kind: "style" | "labelPosition" | "crop" })
  | (PanelChange & { kind: "labelVisibility"; visible: boolean })
  | (PanelChange & { kind: "replace"; before: string; after: string })
  | (PanelChange & { kind: "add" | "remove" })
  | { kind: "labelSize"; panelId?: string; label?: string; before: number; after: number }
  | { kind: "labelColor"; panelId?: string; label?: string; before: string; after: string }
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
    lines.push({ kind: "canvas", beforeWidth: round(base.canvas.widthMm), beforeHeight: round(base.canvas.heightMm),
      width: round(preview.canvas.widthMm), height: round(preview.canvas.heightMm) });
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
  for (const id of base.panelOrder) {
    if (!preview.panels[id]) lines.push({ kind: "remove", panelId: id, label: labelName(base, id) });
  }
  for (const id of preview.panelOrder) {
    const before = base.panels[id], after = preview.panels[id];
    if (!after) continue;
    const nextLabel = labelName(preview, id);
    if (!before) {
      lines.push({ kind: "add", panelId: id, label: nextLabel });
      continue;
    }
    const target = { panelId: id, label: labelName(base, id) };
    if (before.assetId !== after.assetId) lines.push({ kind: "replace", ...target, before: before.assetId, after: after.assetId });
    if (target.label !== nextLabel) lines.push({ kind: "text", ...target, text: nextLabel });
    if (before.locked !== after.locked) lines.push({ kind: "lock", ...target, locked: after.locked });
    const prev = before.labelOverrides, next = after.labelOverrides;
    if (changed(prev.typography, next.typography)) {
      const a = { ...base.labelStyle, ...prev.typography }, b = { ...preview.labelStyle, ...next.typography };
      if (a.fontSizePt !== b.fontSizePt) lines.push({ kind: "labelSize", ...target, before: a.fontSizePt, after: b.fontSizePt });
      if (a.color !== b.color) lines.push({ kind: "labelColor", ...target, before: a.color, after: b.color });
      if (a.fontId !== b.fontId || a.fontWeight !== b.fontWeight) lines.push({ kind: "style", ...target });
    }
    if (changed(before.cropNormalized, after.cropNormalized)) lines.push({ kind: "crop", ...target });
    if (changed(prev.offsetMm, next.offsetMm) || prev.placement !== next.placement) lines.push({ kind: "labelPosition", ...target });
    if (prev.visible !== next.visible) lines.push({ kind: "labelVisibility", ...target, visible: preview.labelStyle.visible && next.visible !== false });
    const a = before.frameMm, b = after.frameMm;
    if (Math.abs(a.width - b.width) > 0.0001 || Math.abs(a.height - b.height) > 0.0001)
      lines.push({ kind: "size", ...target, before: `${round(a.width)}×${round(a.height)}`, after: `${round(b.width)}×${round(b.height)}` });
    if (Math.abs(a.x - b.x) > 0.0001 || Math.abs(a.y - b.y) > 0.0001)
      lines.push({ kind: "move", ...target, dx: round(b.x - a.x), dy: round(b.y - a.y), beforeX: round(a.x), afterX: round(b.x), beforeY: round(a.y), afterY: round(b.y) });
  }
  return lines;
}
export function unchangedPanelCount(base: FigureDocumentV1, preview: FigureDocumentV1): number {
  if (JSON.stringify(base.labelStyle) !== JSON.stringify(preview.labelStyle) || JSON.stringify(base.groups) !== JSON.stringify(preview.groups)) return 0;
  return base.panelOrder.filter(id => JSON.stringify(base.panels[id]) === JSON.stringify(preview.panels[id]) && labelName(base, id) === labelName(preview, id)).length;
}
function round(n: number) { return Math.round(n * 100) / 100; }
