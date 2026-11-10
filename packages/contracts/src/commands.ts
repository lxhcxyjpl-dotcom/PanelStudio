import Type, { type Static } from "typebox";
import { RESOURCE_LIMITS } from "./constants.js";
import {
  CanvasSchema,
  FigureDocumentSchema,
  LabelOverridesSchema,
  LabelStyleSchema,
  LayoutSettingsSchema,
} from "./document.js";
import { DiagnosticSchema } from "./diagnostics.js";
import {
  CropNormalizedSchema,
  DocumentHashSchema,
  RectMmSchema,
  RevisionSchema,
  UuidSchema,
} from "./primitives.js";
import { object } from "./schema.js";

const panelIdList = Type.Array(UuidSchema, { minItems: 1, uniqueItems: true });

export const PanelAddCommandSchema = object(
  {
    type: Type.Literal("panel.add"),
    panelId: UuidSchema,
    assetId: UuidSchema,
    frameMm: RectMmSchema,
    cropNormalized: Type.Optional(CropNormalizedSchema),
  },
  {
    description:
      "When cropNormalized is omitted, the handler uses the full crop {x:0,y:0,width:1,height:1}. The field has no JSON Schema default.",
  },
);

export const PanelRemoveCommandSchema = object(
  {
    type: Type.Literal("panel.remove"),
    panelIds: panelIdList,
  },
  {
    description:
      "Deletes panels and updates label order, stack order, and constraints. A locked panel cannot be deleted. A group with fewer than two remaining members dissolves.",
  },
);

export const PanelRenameCommandSchema = object({
  type: Type.Literal("panel.rename"),
  panelId: UuidSchema,
  name: Type.String(),
});

export const PanelReplaceAssetCommandSchema = object(
  {
    type: Type.Literal("panel.replaceAsset"),
    panelId: UuidSchema,
    assetId: UuidSchema,
  },
  {
    description:
      "Show the new asset in full, uniformly fitted into the old frame, with the center held.",
  },
);

export const PanelSetFramesCommandSchema = object(
  {
    type: Type.Literal("panel.setFrames"),
    items: Type.Array(
      object({
        panelId: UuidSchema,
        frameMm: RectMmSchema,
      }),
      { minItems: 1 },
    ),
  },
  {
    description:
      "Moves and uniform scales. A grouped translation includes every member, with the same dx and dy and unchanged sizes.",
  },
);

export const PanelSetCropCommandSchema = object(
  {
    type: Type.Literal("panel.setCrop"),
    panelId: UuidSchema,
    cropNormalized: CropNormalizedSchema,
  },
  {
    description: "The handler computes the next frame so source content stays in place.",
  },
);

export const PanelSetLockedCommandSchema = object({
  type: Type.Literal("panel.setLocked"),
  panelIds: panelIdList,
  locked: Type.Boolean(),
});

export const PanelReorderLabelsCommandSchema = object(
  {
    type: Type.Literal("panel.reorderLabels"),
    panelOrder: Type.Array(UuidSchema, {
      uniqueItems: true,
      maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
    }),
    resetTextOverrides: Type.Boolean({
      description:
        "Required. false keeps custom text. The handbook's usual value is false; clearing text must be explicit.",
    }),
  },
  { description: "Changes label order only. Does not follow from a drag or a stack change." },
);

export const PanelSetStackOrderCommandSchema = object(
  {
    type: Type.Literal("panel.setStackOrder"),
    stackOrder: Type.Array(UuidSchema, {
      uniqueItems: true,
      maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
    }),
  },
  { description: "Changes paint order only. Does not renumber labels." },
);

export const LabelSetStyleCommandSchema = object(
  {
    type: Type.Literal("label.setStyle"),
    labelStyle: LabelStyleSchema,
  },
  { description: "Replaces the global label style and keeps existing per-panel overrides." },
);

export const LabelSetOverridesCommandSchema = object({
  type: Type.Literal("label.setOverrides"),
  items: Type.Array(
    object({
      panelId: UuidSchema,
      value: LabelOverridesSchema,
    }),
    { minItems: 1 },
  ),
});

export const CanvasSetCommandSchema = object(
  {
    type: Type.Literal("canvas.set"),
    canvas: CanvasSchema,
  },
  {
    description:
      "Replaces the canvas. A resize that also reflows panels is submitted with the reflow commands in the same transaction.",
  },
);

export const LayoutSetSettingsCommandSchema = object(
  {
    type: Type.Literal("layout.setSettings"),
    layoutSettings: LayoutSettingsSchema,
  },
  { description: "Replaces layout settings and does not run layout." },
);

export const GroupCreateCommandSchema = object({
  type: Type.Literal("group.create"),
  groupId: UuidSchema,
  name: Type.String(),
  panelIds: Type.Array(UuidSchema, { minItems: 2, uniqueItems: true }),
});

export const GroupRenameCommandSchema = object({
  type: Type.Literal("group.rename"),
  groupId: UuidSchema,
  name: Type.String(),
});

export const GroupRemoveCommandSchema = object(
  {
    type: Type.Literal("group.remove"),
    groupId: UuidSchema,
  },
  { description: "Dissolves the group and does not delete its panels." },
);

export const GroupSetLockedCommandSchema = object({
  type: Type.Literal("group.setLocked"),
  groupId: UuidSchema,
  locked: Type.Boolean(),
});

export const DomainCommandSchema = Type.Union([
  PanelAddCommandSchema,
  PanelRemoveCommandSchema,
  PanelRenameCommandSchema,
  PanelReplaceAssetCommandSchema,
  PanelSetFramesCommandSchema,
  PanelSetCropCommandSchema,
  PanelSetLockedCommandSchema,
  PanelReorderLabelsCommandSchema,
  PanelSetStackOrderCommandSchema,
  LabelSetStyleCommandSchema,
  LabelSetOverridesCommandSchema,
  CanvasSetCommandSchema,
  LayoutSetSettingsCommandSchema,
  GroupCreateCommandSchema,
  GroupRenameCommandSchema,
  GroupRemoveCommandSchema,
  GroupSetLockedCommandSchema,
]);

export const TransactionCommandsRequestSchema = object({
  baseRevision: RevisionSchema,
  commands: Type.Array(DomainCommandSchema, {
    minItems: 1,
    maxItems: RESOURCE_LIMITS.maxCommandsPerTransaction,
  }),
});

export const TransactionCandidateRequestSchema = object({
  baseRevision: RevisionSchema,
  candidateId: UuidSchema,
});

export const TransactionRequestSchema = Type.Union(
  [TransactionCommandsRequestSchema, TransactionCandidateRequestSchema],
  { description: "Exactly one of commands or candidateId, plus baseRevision." },
);

export const HistoryFlagsSchema = object({
  canUndo: Type.Boolean(),
  canRedo: Type.Boolean(),
});

export const TransactionResponseSchema = object({
  projectId: UuidSchema,
  revision: RevisionSchema,
  changed: Type.Boolean(),
  document: FigureDocumentSchema,
  documentHash: DocumentHashSchema,
  diagnostics: Type.Array(DiagnosticSchema),
  history: HistoryFlagsSchema,
});

export type DomainCommand = Static<typeof DomainCommandSchema>;
export type TransactionRequest = Static<typeof TransactionRequestSchema>;
export type TransactionResponse = Static<typeof TransactionResponseSchema>;
