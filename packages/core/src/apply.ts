import {
  FULL_CROP,
  RESOURCE_LIMITS,
  isFigureDocument,
  type DomainCommand,
  type FigureDocumentV1,
  type PanelGroup,
} from "@panelstudio/contracts";
import { DocumentCommandError } from "./errors.js";
import {
  cropsNearlyEqual,
  fitFrameContain,
  frameAfterCrop,
  framesNearlyEqual,
  nearlyEqualMm,
  aspectMatches,
  cropIsInsideUnitSquare,
  rectIsOnCanvas,
} from "./geometry.js";
import { INHERITED_LABEL_OVERRIDES, resolvePanelLabel } from "./labels.js";

export { DocumentCommandError } from "./errors.js";

export type ReadyAssetFacts = {
  id: string;
  originalFilename: string;
  viewport: { width: number; height: number };
  rasterPixelSize: { width: number; height: number } | null;
};

export type AssetLookup = (assetId: string) => ReadyAssetFacts | null;

type Frame = FigureDocumentV1["panels"][string]["frameMm"];

/**
 * Applies one transaction of domain commands to a clone.
 * Lock and group rules are checked on each command. Crop, aspect, and
 * canvas rules are checked on the final document.
 */
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

function applyOne(document: FigureDocumentV1, command: DomainCommand, assets: AssetLookup): void {
  switch (command.type) {
    case "panel.add":
      applyAdd(document, command, assets);
      return;
    case "panel.remove":
      applyRemove(document, command);
      return;
    case "panel.rename":
      applyRename(document, command);
      return;
    case "panel.replaceAsset":
      applyReplaceAsset(document, command, assets);
      return;
    case "panel.setFrames":
      applySetFrames(document, command);
      return;
    case "panel.setCrop":
      applySetCrop(document, command, assets);
      return;
    case "panel.setLocked":
      applySetLocked(document, command);
      return;
    case "panel.reorderLabels":
      applyReorderLabels(document, command);
      return;
    case "panel.setStackOrder":
      applySetStackOrder(document, command);
      return;
    case "label.setStyle":
      document.labelStyle = command.labelStyle;
      return;
    case "label.setOverrides":
      applyLabelOverrides(document, command);
      return;
    case "canvas.set":
      document.canvas = command.canvas;
      return;
    case "layout.setSettings":
      document.layoutSettings = command.layoutSettings;
      return;
    case "group.create":
      applyGroupCreate(document, command);
      return;
    case "group.rename":
      applyGroupRename(document, command);
      return;
    case "group.remove":
      applyGroupRemove(document, command);
      return;
    case "group.setLocked":
      applyGroupSetLocked(document, command);
      return;
    default: {
      const unexpected: never = command;
      throw new DocumentCommandError("DOCUMENT_INVALID", `Unexpected command ${String(unexpected)}.`);
    }
  }
}

function applyAdd(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.add" }>,
  assets: AssetLookup,
): void {
  if (document.panels[command.panelId]) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "That panel id already exists.", {
      panelIds: [command.panelId],
    });
  }
  if (document.panelOrder.length >= RESOURCE_LIMITS.maxPanelsPerProject) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "A project can contain at most 8 panels.", {
      panelIds: [command.panelId],
    });
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
}

function applyRemove(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.remove" }>,
): void {
  for (const panelId of command.panelIds) requirePanel(document, panelId);
  const locked = command.panelIds.filter((panelId) => isProtected(document, panelId));
  if (locked.length > 0) {
    throw new DocumentCommandError("LOCKED_ELEMENT", "The element is locked.", {
      panelIds: unique(locked),
    });
  }
  const removed = new Set(command.panelIds);
  for (const panelId of removed) delete document.panels[panelId];
  document.panelOrder = document.panelOrder.filter((panelId) => !removed.has(panelId));
  document.stackOrder = document.stackOrder.filter((panelId) => !removed.has(panelId));
  for (const [groupId, group] of Object.entries(document.groups)) {
    const panelIds = group.panelIds.filter((panelId) => !removed.has(panelId));
    if (panelIds.length < 2) delete document.groups[groupId];
    else document.groups[groupId] = { ...group, panelIds };
  }
  document.layoutSettings.constraints = document.layoutSettings.constraints.flatMap((constraint) => {
    const panelIds = constraint.panelIds.filter((panelId) => !removed.has(panelId));
    if (panelIds.length < 2) return [];
    return [{ ...constraint, panelIds }];
  });
  if (
    document.layoutSettings.primaryPanelId &&
    removed.has(document.layoutSettings.primaryPanelId)
  ) {
    document.layoutSettings.primaryPanelId = null;
  }
}

function applyRename(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.rename" }>,
): void {
  requirePanel(document, command.panelId).name = command.name;
}

function applyReplaceAsset(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.replaceAsset" }>,
  assets: AssetLookup,
): void {
  const panel = requirePanel(document, command.panelId);
  const asset = assets(command.assetId);
  if (!asset) {
    throw new DocumentCommandError(
      "DOCUMENT_INVALID",
      "A panel can only reference a ready asset in this project.",
      { assetIds: [command.assetId], panelIds: [command.panelId] },
    );
  }
  const frame = fitFrameContain(panel.frameMm, asset.viewport);
  const geometryChanges =
    !cropsNearlyEqual(panel.cropNormalized, FULL_CROP) || !framesNearlyEqual(panel.frameMm, frame);
  const assetChanges = panel.assetId !== command.assetId;
  if (!geometryChanges && !assetChanges) return;
  if (geometryChanges && isProtected(document, command.panelId)) {
    throw new DocumentCommandError("LOCKED_ELEMENT", "The element is locked.", {
      panelIds: [command.panelId],
    });
  }
  if (findGroup(document, command.panelId)) {
    throw new DocumentCommandError("GROUP_PARTIAL_EDIT", "The edit group was partially edited.", {
      panelIds: memberIds(document, command.panelId),
    });
  }
  panel.assetId = command.assetId;
  panel.cropNormalized = { ...FULL_CROP };
  panel.frameMm = frame;
}

function applySetFrames(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.setFrames" }>,
): void {
  const nextFrames = new Map<string, Frame>();
  for (const item of command.items) {
    requirePanel(document, item.panelId);
    nextFrames.set(item.panelId, item.frameMm);
  }
  const changed: string[] = [];
  for (const [panelId, frame] of nextFrames) {
    if (!framesNearlyEqual(requirePanel(document, panelId).frameMm, frame)) changed.push(panelId);
  }
  const locked = changed.filter((panelId) => isProtected(document, panelId));
  if (locked.length > 0) {
    throw new DocumentCommandError("LOCKED_ELEMENT", "The element is locked.", {
      panelIds: unique(locked),
    });
  }
  const violated: string[] = [];
  for (const group of Object.values(document.groups)) {
    if (group.locked) continue;
    const moved = group.panelIds.filter((panelId) => changed.includes(panelId));
    if (moved.length === 0) continue;
    const deltas = group.panelIds.map((panelId) => {
      const before = requirePanel(document, panelId).frameMm;
      const after = nextFrames.get(panelId) ?? before;
      return { before, after, dx: after.x - before.x, dy: after.y - before.y };
    });
    const anchor = deltas[0];
    if (!anchor) continue;
    const uniformShift = deltas.every(
      (delta) =>
        nearlyEqualMm(delta.dx, anchor.dx) &&
        nearlyEqualMm(delta.dy, anchor.dy) &&
        nearlyEqualMm(delta.before.width, delta.after.width) &&
        nearlyEqualMm(delta.before.height, delta.after.height),
    );
    if (!uniformShift) violated.push(...group.panelIds);
  }
  if (violated.length > 0) {
    throw new DocumentCommandError("GROUP_PARTIAL_EDIT", "The edit group was partially edited.", {
      panelIds: unique(violated),
    });
  }
  for (const [panelId, frame] of nextFrames) requirePanel(document, panelId).frameMm = frame;
}

function applySetCrop(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.setCrop" }>,
  assets: AssetLookup,
): void {
  const panel = requirePanel(document, command.panelId);
  if (cropsNearlyEqual(panel.cropNormalized, command.cropNormalized)) return;
  const asset = assets(panel.assetId);
  if (!asset) {
    throw new DocumentCommandError(
      "DOCUMENT_INVALID",
      "A panel references an asset that is not ready in this project.",
      { panelIds: [command.panelId], assetIds: [panel.assetId] },
    );
  }
  if (isProtected(document, command.panelId)) {
    throw new DocumentCommandError("LOCKED_ELEMENT", "The element is locked.", {
      panelIds: [command.panelId],
    });
  }
  if (findGroup(document, command.panelId)) {
    throw new DocumentCommandError("GROUP_PARTIAL_EDIT", "The edit group was partially edited.", {
      panelIds: memberIds(document, command.panelId),
    });
  }
  panel.frameMm = frameAfterCrop(
    panel.frameMm,
    panel.cropNormalized,
    command.cropNormalized,
    asset.viewport,
  );
  panel.cropNormalized = command.cropNormalized;
}

function applySetLocked(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.setLocked" }>,
): void {
  for (const panelId of command.panelIds) requirePanel(document, panelId).locked = command.locked;
}

function applyReorderLabels(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.reorderLabels" }>,
): void {
  if (!sameIds(Object.keys(document.panels), command.panelOrder)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "panelOrder must list every panel id once.");
  }
  document.panelOrder = [...command.panelOrder];
  if (!command.resetTextOverrides) return;
  for (const panel of Object.values(document.panels)) {
    panel.labelOverrides = { ...panel.labelOverrides, text: null };
  }
}

function applySetStackOrder(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "panel.setStackOrder" }>,
): void {
  if (!sameIds(Object.keys(document.panels), command.stackOrder)) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "stackOrder must list every panel id once.");
  }
  document.stackOrder = [...command.stackOrder];
}

function applyLabelOverrides(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "label.setOverrides" }>,
): void {
  for (const item of command.items) {
    const panel = document.panels[item.panelId];
    if (!panel) {
      throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", {
        panelIds: [item.panelId],
      });
    }
    panel.labelOverrides = item.value;
  }
}

function applyGroupCreate(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "group.create" }>,
): void {
  if (document.groups[command.groupId]) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "That group id already exists.");
  }
  for (const panelId of command.panelIds) {
    requirePanel(document, panelId);
    if (findGroup(document, panelId)) {
      throw new DocumentCommandError("DOCUMENT_INVALID", "A panel already belongs to a group.", {
        panelIds: [panelId],
      });
    }
  }
  document.groups[command.groupId] = {
    name: command.name,
    panelIds: [...command.panelIds],
    locked: false,
  };
}

function applyGroupRename(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "group.rename" }>,
): void {
  requireGroup(document, command.groupId).name = command.name;
}

function applyGroupRemove(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "group.remove" }>,
): void {
  requireGroup(document, command.groupId);
  delete document.groups[command.groupId];
}

function applyGroupSetLocked(
  document: FigureDocumentV1,
  command: Extract<DomainCommand, { type: "group.setLocked" }>,
): void {
  requireGroup(document, command.groupId).locked = command.locked;
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
    throw new DocumentCommandError("OUTSIDE_CANVAS", "A panel or its label is outside the canvas.", {
      panelIds: [...new Set(outside)],
    });
  }
}

function requirePanel(document: FigureDocumentV1, panelId: string) {
  const panel = document.panels[panelId];
  if (!panel) {
    throw new DocumentCommandError("DOCUMENT_INVALID", "The panel does not exist.", {
      panelIds: [panelId],
    });
  }
  return panel;
}

function requireGroup(document: FigureDocumentV1, groupId: string): PanelGroup {
  const group = document.groups[groupId];
  if (!group) throw new DocumentCommandError("DOCUMENT_INVALID", "The group does not exist.");
  return group;
}

function findGroup(
  document: FigureDocumentV1,
  panelId: string,
): { id: string; group: PanelGroup } | null {
  for (const [id, group] of Object.entries(document.groups)) {
    if (group.panelIds.includes(panelId)) return { id, group };
  }
  return null;
}

function isProtected(document: FigureDocumentV1, panelId: string): boolean {
  if (document.panels[panelId]?.locked) return true;
  return findGroup(document, panelId)?.group.locked === true;
}

function memberIds(document: FigureDocumentV1, panelId: string): string[] {
  return findGroup(document, panelId)?.group.panelIds ?? [panelId];
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sameIds(ids: string[], order: string[]): boolean {
  if (ids.length !== order.length) return false;
  const seen = new Set(order);
  if (seen.size !== order.length) return false;
  return ids.every((id) => seen.has(id));
}
