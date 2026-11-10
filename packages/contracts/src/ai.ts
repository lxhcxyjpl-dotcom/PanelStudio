import Type, { type Static } from "typebox";
import { AI_ADAPTER_ID, RESOURCE_LIMITS } from "./constants.js";
import {
  LabelFormatSchema,
  LabelPlacementSchema,
  LabelSequenceSchema,
  LabelTypographyOverrideSchema,
} from "./document.js";
import { LayoutRequestSchema } from "./layout.js";
import {
  FontIdSchema,
  FontWeightSchema,
  HexColorSchema,
  NonEmptyStringSchema,
  NonNegativeMmSchema,
  PointMmSchema,
  PositiveMmSchema,
  RevisionSchema,
  UuidSchema,
} from "./primitives.js";
import { nullable, object } from "./schema.js";

export const StructuredOutputSchema = Type.Union([
  Type.Literal("json_schema"),
  Type.Literal("json_object"),
  Type.Literal("text_json"),
]);

export const AIProviderCapabilitiesSchema = object({
  imageInput: Type.Boolean(),
  structuredOutput: StructuredOutputSchema,
});

export const AIProviderConfigSchema = object(
  {
    adapter: Type.Literal(AI_ADAPTER_ID),
    baseUrl: Type.String({
      minLength: 1,
      format: "uri",
      description:
        "API prefix. The adapter appends /chat/completions once. Remote endpoints use HTTPS unless allowLocalEndpoint is true.",
    }),
    model: NonEmptyStringSchema,
    capabilities: AIProviderCapabilitiesSchema,
    allowLocalEndpoint: Type.Boolean(),
  },
  { description: "Non-secret provider settings. The response model has no secret field." },
);

export const AIProviderSettingsSchema = object({
  configRevision: RevisionSchema,
  hasSecret: Type.Boolean(),
  config: nullable(AIProviderConfigSchema),
});

export const SecretWriteRequestSchema = object({
  secret: NonEmptyStringSchema,
});

export const SecretWriteResponseSchema = object({
  configRevision: RevisionSchema,
  hasSecret: Type.Literal(true),
});

export const SecretDeleteResponseSchema = object({
  configRevision: RevisionSchema,
  hasSecret: Type.Literal(false),
});

export const AILayoutRequestSchema = object({
  baseRevision: RevisionSchema,
  prompt: Type.String({
    minLength: 1,
    maxLength: RESOURCE_LIMITS.maxAiPromptCharacters,
  }),
  selectedPanelIds: Type.Array(UuidSchema, {
    uniqueItems: true,
    maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
  }),
  replyLocale: NonEmptyStringSchema,
  includePreviewImage: Type.Boolean(),
  visualReview: Type.Boolean(),
});

export const TargetRefSchema = object({
  kind: Type.Union([Type.Literal("panel"), Type.Literal("group")]),
  id: UuidSchema,
});

export const AlignEdgeSchema = Type.Union([
  Type.Literal("left"),
  Type.Literal("right"),
  Type.Literal("top"),
  Type.Literal("bottom"),
  Type.Literal("centerX"),
  Type.Literal("centerY"),
]);

export const AlignReferenceSchema = Type.Union([
  object({ kind: Type.Literal("canvas") }),
  object({ kind: Type.Literal("target"), target: TargetRefSchema }),
]);

export const LabelStylePatchSchema = object({
  visible: Type.Optional(Type.Boolean()),
  sequence: Type.Optional(LabelSequenceSchema),
  format: Type.Optional(LabelFormatSchema),
  placement: Type.Optional(LabelPlacementSchema),
  gapMm: Type.Optional(NonNegativeMmSchema),
  fontId: Type.Optional(FontIdSchema),
  fontSizePt: Type.Optional(PositiveMmSchema),
  fontWeight: Type.Optional(FontWeightSchema),
  color: Type.Optional(HexColorSchema),
});

export const LabelOverridePatchSchema = object({
  visible: Type.Optional(nullable(Type.Boolean())),
  text: Type.Optional(nullable(Type.String({ minLength: 1, maxLength: 16, pattern: "^[^\\r\\n]+$" }))),
  placement: Type.Optional(nullable(LabelPlacementSchema)),
  offsetMm: Type.Optional(nullable(PointMmSchema)),
  typography: Type.Optional(nullable(LabelTypographyOverrideSchema)),
});

const targetList = Type.Array(TargetRefSchema, { minItems: 1 });

export const AILayoutActionSchema = object({
  type: Type.Literal("layout"),
  request: LayoutRequestSchema,
});

export const AISetCanvasActionSchema = object({
  type: Type.Literal("set_canvas"),
  widthMm: Type.Optional(PositiveMmSchema),
  heightMm: Type.Optional(PositiveMmSchema),
  heightMode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("fixed")])),
});

export const AISetGutterActionSchema = object({
  type: Type.Literal("set_gutter"),
  horizontalMm: NonNegativeMmSchema,
  verticalMm: NonNegativeMmSchema,
});

export const AISetLabelStyleActionSchema = object({
  type: Type.Literal("set_label_style"),
  patch: LabelStylePatchSchema,
});

export const AISetPanelLabelActionSchema = object({
  type: Type.Literal("set_panel_label"),
  panelId: UuidSchema,
  patch: LabelOverridePatchSchema,
});

export const AIMoveByMmActionSchema = object(
  {
    type: Type.Literal("move_by_mm"),
    targets: targetList,
    dxMm: Type.Number(),
    dyMm: Type.Number(),
  },
  { description: "Translation only. Does not scale or reflow other panels." },
);

export const AIScaleToWidthActionSchema = object(
  {
    type: Type.Literal("scale_to_width"),
    panelId: UuidSchema,
    widthMm: PositiveMmSchema,
  },
  {
    description:
      "Uniform scale. The v0.1 AI action keeps the top-left corner. It has no anchor field.",
  },
);

export const AIAlignActionSchema = object({
  type: Type.Literal("align"),
  targets: targetList,
  edge: AlignEdgeSchema,
  reference: AlignReferenceSchema,
});

export const AIDistributeActionSchema = object({
  type: Type.Literal("distribute"),
  targets: Type.Array(TargetRefSchema, { minItems: 2 }),
  axis: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")]),
});

export const AISetLockActionSchema = object({
  type: Type.Literal("set_lock"),
  targets: targetList,
  locked: Type.Boolean(),
});

export const AIRelabelActionSchema = object({
  type: Type.Literal("relabel"),
  panelOrder: Type.Array(UuidSchema, {
    uniqueItems: true,
    maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
  }),
  resetTextOverrides: Type.Boolean(),
});

export const AIActionSchema = Type.Union([
  AILayoutActionSchema,
  AISetCanvasActionSchema,
  AISetGutterActionSchema,
  AISetLabelStyleActionSchema,
  AISetPanelLabelActionSchema,
  AIMoveByMmActionSchema,
  AIScaleToWidthActionSchema,
  AIAlignActionSchema,
  AIDistributeActionSchema,
  AISetLockActionSchema,
  AIRelabelActionSchema,
]);

export const AIProposalSchema = object({
  version: Type.Literal(1),
  kind: Type.Literal("proposal"),
  summary: NonEmptyStringSchema,
  actions: Type.Array(AIActionSchema, { minItems: 1 }),
});

export const AIClarificationSchema = object({
  version: Type.Literal(1),
  kind: Type.Literal("clarification"),
  question: NonEmptyStringSchema,
  options: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1 })),
});

export const AIUnsupportedSchema = object({
  version: Type.Literal(1),
  kind: Type.Literal("unsupported"),
  reason: NonEmptyStringSchema,
});

export const AIIntentSchema = Type.Union([
  AIProposalSchema,
  AIClarificationSchema,
  AIUnsupportedSchema,
]);

export type AIProviderConfig = Static<typeof AIProviderConfigSchema>;
export type AILayoutRequest = Static<typeof AILayoutRequestSchema>;
export type AIAction = Static<typeof AIActionSchema>;
export type AIIntent = Static<typeof AIIntentSchema>;
export type TargetRef = Static<typeof TargetRefSchema>;
