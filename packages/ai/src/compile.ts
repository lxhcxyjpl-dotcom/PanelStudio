import {
  ENGINE_VERSIONS,
  RESOURCE_LIMITS,
  resolveLabelText,
  type AIEditScope,
  type AIIntent,
  type Diagnostic,
  type DomainCommand,
  type FigureDocumentV1,
  type LayoutScore,
  type LayoutExample,
  layoutUnitIds,
} from "@panelstudio/contracts";
import {
  DocumentCommandError,
  alignSelection,
  applyCommands,
  canonicalJson,
  distributeSelection,
  scalePanel,
  translateSelection,
  type AssetLookup,
} from "@panelstudio/core";
import { solveLayout, type LayoutAssetFacts } from "@panelstudio/layout";
import { AiCompileError } from "./errors.js";

export type CompileResult = {
  commands: DomainCommand[];
  previewDocument: FigureDocumentV1;
  validationMode: "edit" | "layout";
  summary: string;
  diagnostics: Diagnostic[];
  score: LayoutScore;
};

const UNKNOWN_SCORE: LayoutScore = {
  scoringVersion: ENGINE_VERSIONS.layout,
  penalties: {
    readability: "unknown",
    whitespace: "unknown",
    emphasis: "unknown",
    consistency: "unknown",
    height: "unknown",
    movement: "unknown",
  },
  total: null,
};

/**
 * Compiles a validated proposal into existing domain commands.
 * The same document and the same intent produce the same commands.
 * Layout uses the existing solver. Align, move, and scale use the edit kernel.
 */
export function compileProposal(
  document: FigureDocumentV1,
  intent: Extract<AIIntent, { kind: "proposal" }>,
  assets: AssetLookup,
  selection?: { scope: AIEditScope; selectedPanelIds: string[] },
  examples: LayoutExample[] = [],
): CompileResult {
  let current = document;
  const commands: DomainCommand[] = [];
  const notes: string[] = [];
  let score = UNKNOWN_SCORE;
  const diagnostics: Diagnostic[] = [];
  const layoutAssets = layoutFacts(document, assets);
  for (const action of intent.actions) {
    const selected = selection?.scope === "selection" ? selection.selectedPanelIds : null;
    if (selected && (action.type === "set_canvas" || action.type === "set_gutter" || action.type === "relabel" || action.type === "reference_layout" ||
      action.type === "layout" && action.request.family !== "selection-row")) {
      throw new AiCompileError("AI_SCOPE_VIOLATION", "This change requires document scope.", { reason: "scope-conflict" });
    }
    const produced = compileAction(current, action, layoutAssets, assets, notes, selected, examples);
    if (produced.score) score = produced.score;
    diagnostics.push(...produced.diagnostics);
    if (produced.commands.length === 0) continue;
    if (commands.length + produced.commands.length > RESOURCE_LIMITS.maxCommandsPerTransaction) {
      throw new AiCompileError("AI_CHAIN_LIMIT", "This draft exceeds 64 commands.", { reason: "command-limit" });
    }
    current = applyCommands(current, produced.commands, assets);
    commands.push(...produced.commands);
  }
  const replay = applyCommands(document, commands, assets);
  if (canonicalJson(replay) !== canonicalJson(current)) {
    throw new AiCompileError("DOCUMENT_INVALID", "The compiled commands did not replay.");
  }
  if (selection?.scope === "selection") assertSelectionResult(document, current, selection.selectedPanelIds, intent.actions);
  const validationMode = intent.actions.some((action) => action.type === "layout" || action.type === "reference_layout") ? "layout" : "edit";
  const summary = [intent.summary, ...notes].filter((part) => part.length > 0).join(" ");
  return {
    commands,
    previewDocument: current,
    validationMode,
    summary,
    diagnostics,
    score,
  };
}

function compileAction(
  document: FigureDocumentV1,
  action: Extract<AIIntent, { kind: "proposal" }>["actions"][number],
  layoutAssets: Record<string, LayoutAssetFacts>,
  assets: AssetLookup,
  notes: string[],
  selected: string[] | null,
  examples: LayoutExample[],
): { commands: DomainCommand[]; score?: LayoutScore; diagnostics: Diagnostic[] } {
  switch (action.type) {
    case "reference_layout": {
      const reference = examples.find((example) => example.id === action.referenceId);
      const ids = layoutUnitIds(document);
      if (!reference || reference.slots.length !== ids.length || action.orderedUnitIds.length !== ids.length ||
        new Set(action.orderedUnitIds).size !== ids.length || ids.some((id) => !action.orderedUnitIds.includes(id))) {
        throw new AiCompileError("MODEL_OUTPUT_INVALID", "Reference layout must map every current unit to a provided example.");
      }
      const request = { family: "guided" as const, preferences: action.preferences, referenceAspect: reference.aspect,
        referenceSlots: reference.slots.map((slot, i) => ({ ...slot, unitId: action.orderedUnitIds[i]! })) };
      const solved = solveLayout({ document, request, assets: layoutAssets, maxCandidates: 1 });
      if (!solved.ok) throw new AiCompileError(solved.code, solved.message, solved.details);
      const candidate = solved.candidates[0]!;
      applyCommands(document, candidate.commands, assets);
      return { commands: candidate.commands, score: candidate.score, diagnostics: candidate.diagnostics };
    }
    case "set_canvas": {
      if (action.widthMm === undefined && action.heightMm === undefined && action.heightMode === undefined) {
        throw new AiCompileError("MODEL_OUTPUT_INVALID", "set_canvas did not name a field.");
      }
      return {
        commands: [
          {
            type: "canvas.set",
            canvas: {
              ...document.canvas,
              ...(action.widthMm !== undefined ? { widthMm: action.widthMm } : {}),
              ...(action.heightMm !== undefined ? { heightMm: action.heightMm } : {}),
              ...(action.heightMode !== undefined ? { heightMode: action.heightMode } : {}),
            },
          },
        ],
        diagnostics: [],
      };
    }
    case "set_gutter":
      return {
        commands: [
          {
            type: "layout.setSettings",
            layoutSettings: {
              ...document.layoutSettings,
              gutterMm: { horizontal: action.horizontalMm, vertical: action.verticalMm },
            },
          },
        ],
        diagnostics: [],
      };
    case "set_label_style": {
      if (Object.keys(action.patch).length === 0) {
        throw new AiCompileError("MODEL_OUTPUT_INVALID", "set_label_style did not name a field.");
      }
      if (selected) {
        const { sequence, format, gapMm, visible, placement, ...typography } = action.patch;
        if (sequence !== undefined || format !== undefined || gapMm !== undefined) {
          throw new AiCompileError("AI_SCOPE_VIOLATION", "Label sequence, format and gap require document scope.", { reason: "scope-conflict" });
        }
        if (visible === true && !document.labelStyle.visible) {
          throw new AiCompileError("AI_SCOPE_VIOLATION", "Showing a label while all labels are hidden requires document scope.", { reason: "scope-conflict" });
        }
        return { commands: [{ type: "label.setOverrides", items: selected.map((panelId) => ({
          panelId, value: mergeOverrides(document.panels[panelId]!.labelOverrides, {
            visible, placement, ...(Object.keys(typography).length ? { typography } : {}),
          }),
        })) }], diagnostics: [] };
      }
      return {
        commands: [{ type: "label.setStyle", labelStyle: { ...document.labelStyle, ...action.patch } }],
        diagnostics: [],
      };
    }
    case "set_panel_label": {
      if (Object.keys(action.patch).length === 0) {
        throw new AiCompileError("MODEL_OUTPUT_INVALID", "set_panel_label did not name a field.");
      }
      const panelId = requirePanel(document, action.panelId);
      const panel = document.panels[panelId];
      if (!panel) throw new AiCompileError("MODEL_OUTPUT_INVALID", "The action names a panel that is not in this revision.");
      return {
        commands: [
          {
            type: "label.setOverrides",
            items: [{ panelId, value: mergeOverrides(panel.labelOverrides, action.patch) }],
          },
        ],
        diagnostics: [],
      };
    }
    case "move_by_mm": {
      if (!Number.isFinite(action.dxMm) || !Number.isFinite(action.dyMm)) {
        throw new AiCompileError("MODEL_OUTPUT_INVALID", "move_by_mm needs finite distances.");
      }
      return { commands: [translateSelection(document, panelIds(document, action.targets), action.dxMm, action.dyMm)], diagnostics: [] };
    }
    case "scale_to_width": {
      const panelId = requirePanel(document, action.panelId);
      const before = document.panels[panelId]?.frameMm;
      if (!before) throw new AiCompileError("MODEL_OUTPUT_INVALID", "The action names a panel that is not in this revision.");
      const command = scalePanel(document, action.panelId, { width: action.widthMm }, "top-left");
      if (command.type === "panel.setFrames") {
        const after = command.items[0]?.frameMm;
        if (after) {
          notes.push(
            `${labelOf(document, action.panelId)} ${mm(before.width)}×${mm(before.height)} mm → ${mm(after.width)}×${mm(after.height)} mm`,
          );
        }
      }
      return { commands: [command], diagnostics: [] };
    }
    case "align": {
      const reference =
        action.reference.kind === "canvas"
          ? { kind: "canvas" as const }
          : action.reference.target.kind === "panel"
            ? { kind: "panel" as const, panelId: requirePanel(document, action.reference.target.id) }
            : { kind: "group" as const, groupId: requireGroup(document, action.reference.target.id) };
      return {
        commands: [alignSelection(document, panelIds(document, action.targets), action.edge, reference)],
        diagnostics: [],
      };
    }
    case "distribute":
      return {
        commands: [distributeSelection(document, panelIds(document, action.targets), action.axis)],
        diagnostics: [],
      };
    case "set_lock":
      return { commands: lockCommands(document, action.targets, action.locked), diagnostics: [] };
    case "relabel": {
      const order = new Set(action.panelOrder);
      if (order.size !== document.panelOrder.length || document.panelOrder.some((id) => !order.has(id))) {
        throw new AiCompileError("MODEL_OUTPUT_INVALID", "relabel must list every panel once.");
      }
      return {
        commands: [
          {
            type: "panel.reorderLabels",
            panelOrder: [...action.panelOrder],
            resetTextOverrides: action.resetTextOverrides,
          },
        ],
        diagnostics: [],
      };
    }
    case "layout": {
      const solved = solveLayout({ document, request: action.request, assets: layoutAssets, maxCandidates: 1 });
      if (!solved.ok) {
        throw new AiCompileError(solved.code, solved.message, solved.details);
      }
      const candidate = solved.candidates[0];
      if (!candidate) throw new AiCompileError("LAYOUT_CONFLICT", "Layout did not produce a candidate.");
      applyCommands(document, candidate.commands, assets);
      return { commands: candidate.commands, score: candidate.score, diagnostics: candidate.diagnostics };
    }
    default:
      throw new AiCompileError("MODEL_OUTPUT_INVALID", "The action is not supported.");
  }
}

/** Compare against the immediate working draft, including every field on unselected objects. */
function assertSelectionResult(
  before: FigureDocumentV1, after: FigureDocumentV1, ids: string[],
  actions: Extract<AIIntent, { kind: "proposal" }>["actions"],
): void {
  const allowed = structuredClone(before);
  const selected = new Set(ids);
  const members = new Set(Object.values(before.groups).flatMap((group) => group.panelIds));
  for (const id of ids) {
    const panel = after.panels[id];
    const target = allowed.panels[id];
    if (!target || !panel) continue;
    target.frameMm = panel.frameMm; // Rigid translation and proportional scaling were checked by the edit kernel.
    if (!members.has(id)) {
      target.labelOverrides = panel.labelOverrides;
      target.locked = panel.locked;
    }
  }
  for (const action of actions) {
    if (action.type !== "set_lock") continue;
    for (const target of action.targets) {
      if (target.kind !== "group") continue;
      const group = allowed.groups[target.id];
      if (group && group.panelIds.every((id) => selected.has(id))) group.locked = action.locked;
    }
  }
  if (canonicalJson(allowed) !== canonicalJson(after)) {
    const panelIds = before.panelOrder.filter((id) => canonicalJson(allowed.panels[id]) !== canonicalJson(after.panels[id]));
    throw new AiCompileError("AI_SCOPE_VIOLATION", "The proposal changes fields outside the frozen selection.", { panelIds, reason: "scope-conflict" });
  }
}

function lockCommands(
  document: FigureDocumentV1,
  targets: Array<{ kind: "panel" | "group"; id: string }>,
  locked: boolean,
): DomainCommand[] {
  const groups: string[] = [];
  const panels: string[] = [];
  for (const target of targets) {
    if (target.kind === "group") groups.push(requireGroup(document, target.id));
    else {
      requirePanel(document, target.id);
      panels.push(target.id);
    }
  }
  const commands: DomainCommand[] = [...new Set(groups)]
    .sort((left, right) => left.localeCompare(right))
    .map((groupId) => ({ type: "group.setLocked", groupId, locked }));
  const panelIds = [...new Set(panels)].sort((left, right) => left.localeCompare(right));
  if (panelIds.length > 0) commands.push({ type: "panel.setLocked", panelIds, locked });
  return commands;
}

function panelIds(document: FigureDocumentV1, targets: Array<{ kind: "panel" | "group"; id: string }>): string[] {
  const ids: string[] = [];
  for (const target of targets) {
    if (target.kind === "group") ids.push(...document.groups[requireGroup(document, target.id)]!.panelIds);
    else {
      requirePanel(document, target.id);
      ids.push(target.id);
    }
  }
  return ids;
}

function requirePanel(document: FigureDocumentV1, panelId: string): string {
  if (!document.panels[panelId]) {
    throw new AiCompileError("MODEL_OUTPUT_INVALID", "The action names a panel that is not in this revision.", {
      panelIds: [panelId],
    });
  }
  return panelId;
}

function requireGroup(document: FigureDocumentV1, groupId: string): string {
  if (!document.groups[groupId]) {
    throw new AiCompileError("MODEL_OUTPUT_INVALID", "The action names a group that is not in this revision.");
  }
  return groupId;
}

function labelOf(document: FigureDocumentV1, panelId: string): string {
  const panel = document.panels[panelId];
  const index = document.panelOrder.indexOf(panelId);
  if (!panel || index < 0) return panelId;
  return resolveLabelText({
    index,
    textOverride: panel.labelOverrides.text,
    sequence: document.labelStyle.sequence,
    format: document.labelStyle.format,
  });
}

function mm(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 10000) / 10000);
}

function mergeOverrides(
  current: FigureDocumentV1["panels"][string]["labelOverrides"],
  patch: Partial<FigureDocumentV1["panels"][string]["labelOverrides"]>,
): FigureDocumentV1["panels"][string]["labelOverrides"] {
  const typography =
    patch.typography === undefined
      ? current.typography
      : patch.typography === null
        ? null
        : { ...(current.typography ?? {}), ...patch.typography };
  return {
    visible: patch.visible !== undefined ? patch.visible : current.visible,
    text: patch.text !== undefined ? patch.text : current.text,
    placement: patch.placement !== undefined ? patch.placement : current.placement,
    offsetMm: patch.offsetMm !== undefined ? patch.offsetMm : current.offsetMm,
    typography,
  };
}

function layoutFacts(document: FigureDocumentV1, assets: AssetLookup): Record<string, LayoutAssetFacts> {
  const facts: Record<string, LayoutAssetFacts> = {};
  for (const panel of Object.values(document.panels)) {
    if (facts[panel.assetId]) continue;
    const ready = assets(panel.assetId);
    if (!ready) {
      throw new DocumentCommandError("DOCUMENT_INVALID", "A panel references an asset that is not ready.", {
        assetIds: [panel.assetId],
      });
    }
    facts[panel.assetId] = { viewport: ready.viewport, rasterPixelSize: ready.rasterPixelSize };
  }
  return facts;
}
