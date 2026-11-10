import type { FigureDocumentV1, LabelOverrides } from "@panelstudio/contracts";
import { cropIsInsideUnitSquare, frameAfterCrop } from "@panelstudio/core/geometry";
import type { Selection } from "../state/types";

export function groupForPanel(
  document: FigureDocumentV1,
  panelId: string,
): { id: string; group: FigureDocumentV1["groups"][string] } | null {
  for (const [id, group] of Object.entries(document.groups)) {
    if (group.panelIds.includes(panelId)) return { id, group };
  }
  return null;
}

export function panelIdsOf(selection: Selection, document: FigureDocumentV1): string[] {
  if (selection.kind === "panels") return selection.ids.filter((id) => document.panels[id]);
  if (selection.kind === "label") return document.panels[selection.panelId] ? [selection.panelId] : [];
  if (selection.kind === "group") return document.groups[selection.groupId]?.panelIds ?? [];
  return [];
}

export function geometryLocked(document: FigureDocumentV1, panelId: string): "lock" | "group" | null {
  const panel = document.panels[panelId];
  if (!panel) return "lock";
  if (panel.locked) return "lock";
  const group = groupForPanel(document, panelId);
  if (group?.group.locked) return "lock";
  if (group) return "group";
  return null;
}

export function withCrop(
  document: FigureDocumentV1,
  panelId: string,
  crop: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): FigureDocumentV1 {
  const panel = document.panels[panelId];
  if (!panel) return document;
  let frame = panel.frameMm;
  try {
    frame = frameAfterCrop(panel.frameMm, panel.cropNormalized, crop, viewport);
  } catch {
    return document;
  }
  const next = structuredClone(document);
  const current = next.panels[panelId];
  if (!current) return document;
  next.panels[panelId] = { ...current, cropNormalized: crop, frameMm: frame };
  return next;
}

export function cropInvalid(crop: { x: number; y: number; width: number; height: number }): boolean {
  return !cropIsInsideUnitSquare(crop) || !(crop.width > 0.01) || !(crop.height > 0.01);
}

export function mergedOverrides(current: LabelOverrides, patch: Partial<LabelOverrides>): LabelOverrides {
  const typography =
    patch.typography === undefined
      ? current.typography
      : patch.typography === null
        ? null
        : { ...(current.typography ?? {}), ...patch.typography };
  return { ...current, ...patch, typography };
}

export type { Selection };
