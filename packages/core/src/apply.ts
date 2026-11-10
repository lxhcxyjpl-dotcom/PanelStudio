import {
  FULL_CROP,
  RESOURCE_LIMITS,
  isFigureDocument,
  type DomainCommand,
  type FigureDocumentV1,
} from "@panelstudio/contracts";
import { aspectMatches, cropIsInsideUnitSquare, rectIsOnCanvas } from "./geometry.js";
import { INHERITED_LABEL_OVERRIDES, resolvePanelLabel } from "./labels.js";

export class DocumentCommandError extends Error {
  readonly code: "DOCUMENT_INVALID" | "OUTSIDE_CANVAS";
  readonly details: {
    panelIds?: string[];
    assetIds?: string[];
    constraintIds?: string[];
  };

  constructor(
    code: "DOCUMENT_INVALID" | "OUTSIDE_CANVAS",
    message: string,
    details: DocumentCommandError["details"] = {},
  ) {
    super(message);
    this.name = "DocumentCommandError";
    this.code = code;
    this.details = details;
  }
}

export type ReadyAssetFacts = {
  id: string;
  originalFilename: string;
  viewport: { width: number; height: number };
  rasterPixelSize: { width: number; height: number } | null;
};

export type AssetLookup = (assetId: string) => ReadyAssetFacts | null;

/**
 * Phase 1 applies the commands that create panels and set native labels.
 * The other command names stay in the shared union and are rejected here.
 */
const PHASE1_COMMANDS = new Set<DomainCommand["type"]>([
  "panel.add",
  "label.setStyle",
  "label.setOverrides",
]);

export function applyCommands(
  document: FigureDocumentV1,
  commands: DomainCommand[],
  assets: AssetLookup,
): FigureDocumentV1 {
  const next = structuredClone(document);
  for (const command of commands) {
    applyOne(next, command, assets);
  }
  assertFigureDocument(next, assets);
  return next;
}

function applyOne(
  document: FigureDocumentV1,
  command: DomainCommand,
  assets: AssetLookup,
): void {
  if (!PHASE1_COMMANDS.has(command.type)) {
    throw new DocumentCommandError(
      "DOCUMENT_INVALID",
      `The ${command.type} command is not available in phase 1.`,
    );
  }
  switch (command.type) {
    case "panel.add": {
      if (document.panels[command.panelId]) {
        throw new DocumentCommandError("DOCUMENT_INVALID", "That panel id already exists.", {
          panelIds: [command.panelId],
        });
      }
      if (document.panelOrder.length >= RESOURCE_LIMITS.maxPanelsPerProject) {
        throw new DocumentCommandError(
          "DOCUMENT_INVALID",
          "A project can contain at most 8 panels.",
          { panelIds: [command.panelId] },
        );
      }
      const asset = assets(command.assetId);
      if (!asset) {
        throw new DocumentCommandError(
          "DOCUMENT_INVALID",
          "A panel can only reference a ready asset in this project.",
          { assetIds: [command.assetId], panelIds: [command.panelId] },
        );
      }
      const crop = command.cropNormalized ?? { ...FULL_CROP };
      const name = asset.originalFilename.trim();
      document.panels[command.panelId] = {
        assetId: command.assetId,
        name: name.length > 0 ? name : "Panel",
        frameMm: command.frameMm,
        cropNormalized: crop,
        locked: false,
        labelOverrides: { ...INHERITED_LABEL_OVERRIDES },
      };
      document.panelOrder.push(command.panelId);
      document.stackOrder.push(command.panelId);
      return;
    }
    case "label.setStyle": {
      document.labelStyle = command.labelStyle;
      return;
    }
    case "label.setOverrides": {
      for (const item of command.items) {
        const panel = document.panels[item.panelId];
        if (!panel) {
          throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", {
            panelIds: [item.panelId],
          });
        }
        panel.labelOverrides = item.value;
      }
      return;
    }
    default:
      return;
  }
}

export function assertFigureDocument(document: FigureDocumentV1, assets: AssetLookup): void {
  if (!isFigureDocument(document)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The document does not match the shared schema.");
  }
  const ids = Object.keys(document.panels);
  if (!sameIds(ids, document.panelOrder) || !sameIds(ids, document.stackOrder)) {
    throw new DocumentCommandError(
      "DOCUMENT_INVALID",
      "panelOrder and stackOrder must each list every panel id once.",
    );
  }
  const membership = new Map<string, string>();
  for (const [groupId, group] of Object.entries(document.groups)) {
    for (const panelId of group.panelIds) {
      if (!document.panels[panelId]) {
        throw new DocumentCommandError("DOCUMENT_INVALID", "A group names a missing panel.", {
          panelIds: [panelId],
        });
      }
      const previous = membership.get(panelId);
      if (previous) {
        throw new DocumentCommandError("DOCUMENT_INVALID", "A panel belongs to more than one group.", {
          panelIds: [panelId],
        });
      }
      membership.set(panelId, groupId);
    }
  }
  if (
    document.layoutSettings.primaryPanelId &&
    !document.panels[document.layoutSettings.primaryPanelId]
  ) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The primary panel does not exist.", {
      panelIds: [document.layoutSettings.primaryPanelId],
    });
  }
  if (
    document.layoutSettings.primaryPanelId &&
    membership.has(document.layoutSettings.primaryPanelId)
  ) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The primary panel is grouped.", {
      panelIds: [document.layoutSettings.primaryPanelId],
    });
  }
  for (const constraint of document.layoutSettings.constraints) {
    for (const panelId of constraint.panelIds) {
      if (!document.panels[panelId]) {
        throw new DocumentCommandError("DOCUMENT_INVALID", "A constraint names a missing panel.", {
          panelIds: [panelId],
          constraintIds: [constraint.id],
        });
      }
    }
  }

  const outside: string[] = [];
  for (const panelId of document.panelOrder) {
    const panel = document.panels[panelId];
    if (!panel) continue;
    const asset = assets(panel.assetId);
    if (!asset) {
      throw new DocumentCommandError(
        "DOCUMENT_INVALID",
        "A panel references an asset that is not ready in this project.",
        { panelIds: [panelId], assetIds: [panel.assetId] },
      );
    }
    if (!cropIsInsideUnitSquare(panel.cropNormalized)) {
      throw new DocumentCommandError("DOCUMENT_INVALID", "The crop extends outside the unit square.", {
        panelIds: [panelId],
      });
    }
    if (!aspectMatches(panel.frameMm, panel.cropNormalized, asset.viewport)) {
      throw new DocumentCommandError(
        "DOCUMENT_INVALID",
        "Panel frame does not match the cropped asset aspect ratio.",
        { panelIds: [panelId], assetIds: [panel.assetId] },
      );
    }
    if (!rectIsOnCanvas(panel.frameMm, document.canvas)) {
      outside.push(panelId);
      continue;
    }
    const label = resolvePanelLabel(document, panelId);
    if (label && !rectIsOnCanvas(label.bounds, document.canvas)) outside.push(panelId);
  }
  if (outside.length > 0) {
    throw new DocumentCommandError(
      "OUTSIDE_CANVAS",
      "A panel or its label is outside the canvas.",
      { panelIds: [...new Set(outside)] },
    );
  }
}

function sameIds(ids: string[], order: string[]): boolean {
  if (ids.length !== order.length) return false;
  const seen = new Set(order);
  if (seen.size !== order.length) return false;
  return ids.every((id) => seen.has(id));
}
