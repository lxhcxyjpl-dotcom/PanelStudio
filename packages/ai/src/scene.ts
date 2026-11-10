import {
  AI_ACTION_NAMES,
  resolveLabelText,
  type FigureDocumentV1,
} from "@panelstudio/contracts";
import { canonicalJson } from "@panelstudio/core";

export type FrozenScene = {
  baseRevision: number;
  configRevision: number;
  selectedPanelIds: string[];
  actions: readonly string[];
  canvas: {
    widthMm: number;
    heightMm: number;
    heightMode: "auto" | "fixed";
    background: "#FFFFFF";
  };
  gutterMm: { horizontal: number; vertical: number };
  labelStyle: FigureDocumentV1["labelStyle"];
  panels: Array<{
    panelId: string;
    label: string;
    name: string;
    x: number;
    y: number;
    widthMm: number;
    heightMm: number;
    locked: boolean;
    groupId: string | null;
  }>;
  groups: Array<{ id: string; name: string; panelIds: string[]; locked: boolean }>;
  constraints: FigureDocumentV1["layoutSettings"]["constraints"];
};

export function buildScene(
  document: FigureDocumentV1,
  input: { baseRevision: number; configRevision: number; selectedPanelIds: string[] },
): FrozenScene {
  const groups = Object.entries(document.groups).map(([id, group]) => ({
    id,
    name: group.name,
    panelIds: [...group.panelIds],
    locked: group.locked,
  }));
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const panelId of group.panelIds) groupOf.set(panelId, group.id);
  }
  return {
    baseRevision: input.baseRevision,
    configRevision: input.configRevision,
    selectedPanelIds: [...input.selectedPanelIds],
    actions: AI_ACTION_NAMES,
    canvas: {
      widthMm: document.canvas.widthMm,
      heightMm: document.canvas.heightMm,
      heightMode: document.canvas.heightMode,
      background: document.canvas.background,
    },
    gutterMm: { ...document.layoutSettings.gutterMm },
    labelStyle: { ...document.labelStyle },
    panels: document.panelOrder.flatMap((panelId, index) => {
      const panel = document.panels[panelId];
      if (!panel) return [];
      return [
        {
          panelId,
          label: resolveLabelText({
            index,
            textOverride: panel.labelOverrides.text,
            sequence: document.labelStyle.sequence,
            format: document.labelStyle.format,
          }),
          name: panel.name,
          x: panel.frameMm.x,
          y: panel.frameMm.y,
          widthMm: panel.frameMm.width,
          heightMm: panel.frameMm.height,
          locked: panel.locked,
          groupId: groupOf.get(panelId) ?? null,
        },
      ];
    }),
    groups,
    constraints: document.layoutSettings.constraints.map((constraint) => ({ ...constraint, panelIds: [...constraint.panelIds] })),
  };
}

export function sceneText(scene: FrozenScene): string {
  return canonicalJson(scene);
}
