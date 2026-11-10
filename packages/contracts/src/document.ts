import Type, { type Static } from "typebox";
import { RESOURCE_LIMITS, SCHEMA_VERSION } from "./constants.js";
import {
  CropNormalizedSchema,
  CustomLabelTextSchema,
  FontIdSchema,
  FontWeightSchema,
  HexColorSchema,
  NonNegativeMmSchema,
  PointMmSchema,
  PositiveMmSchema,
  RectMmSchema,
  UuidSchema,
  uuidKeyed,
} from "./primitives.js";
import { object } from "./schema.js";

export const LabelPlacementSchema = Type.Union([
  Type.Literal("outside-top-left"),
  Type.Literal("inside-top-left"),
]);

export const LabelSequenceSchema = Type.Union([
  Type.Literal("upper-alpha"),
  Type.Literal("lower-alpha"),
  Type.Literal("number"),
]);

export const LabelFormatSchema = Type.Union([
  Type.Literal("plain"),
  Type.Literal("parentheses"),
  Type.Literal("dot"),
]);

const fontSizePtSchema = Type.Number({
  exclusiveMinimum: 0,
  description: "Point size.",
});

export const LabelTypographySchema = object({
  fontId: FontIdSchema,
  fontSizePt: fontSizePtSchema,
  fontWeight: FontWeightSchema,
  color: HexColorSchema,
});

/** Partial typography. Omitted fields inherit. This object is not itself null. */
export const LabelTypographyOverrideSchema = object({
  fontId: Type.Optional(FontIdSchema),
  fontSizePt: Type.Optional(fontSizePtSchema),
  fontWeight: Type.Optional(FontWeightSchema),
  color: Type.Optional(HexColorSchema),
});

export const LabelStyleSchema = object(
  {
    fontId: FontIdSchema,
    fontSizePt: fontSizePtSchema,
    fontWeight: FontWeightSchema,
    color: HexColorSchema,
    visible: Type.Boolean({
      description: "false hides every label. A panel override can hide one label only when this is true.",
    }),
    sequence: LabelSequenceSchema,
    format: LabelFormatSchema,
    placement: LabelPlacementSchema,
    gapMm: NonNegativeMmSchema,
  },
  { description: "Global label style for labels this editor creates." },
);

export const LabelOverridesSchema = object(
  {
    visible: Type.Union([Type.Boolean(), Type.Null()], {
      description: "null inherits the global visible flag.",
    }),
    text: Type.Union([CustomLabelTextSchema, Type.Null()], {
      description:
        "null generates the label. A string is used verbatim and is not passed through format. Empty string is invalid.",
    }),
    placement: Type.Union([LabelPlacementSchema, Type.Null()]),
    offsetMm: Type.Union([PointMmSchema, Type.Null()], {
      description:
        "Baseline relative to the visible frame origin. null is automatic. A point wins over placement.",
    }),
    typography: Type.Union([LabelTypographyOverrideSchema, Type.Null()], {
      description: "null inherits every typography field. Omitted partial fields also inherit.",
    }),
  },
  { description: "Per-panel label overrides. null means inherit. Empty string does not." },
);

export const PanelSchema = object(
  {
    assetId: UuidSchema,
    name: Type.String({ description: "User-facing panel name. Not the label text." }),
    frameMm: RectMmSchema,
    cropNormalized: CropNormalizedSchema,
    locked: Type.Boolean({
      description: "Locks move, scale, crop, and delete.",
    }),
    labelOverrides: LabelOverridesSchema,
  },
  {
    description:
      "One instance of an asset. The visible frame excludes an outside label. The panel id is the map key.",
  },
);

export const PanelGroupSchema = object(
  {
    name: Type.String(),
    panelIds: Type.Array(UuidSchema, { minItems: 2, uniqueItems: true }),
    locked: Type.Boolean(),
  },
  {
    description:
      "Single-level edit group of at least two panels. Membership is stored only here.",
  },
);

export const LayoutConstraintSchema = object(
  {
    id: UuidSchema,
    kind: Type.Union([
      Type.Literal("row"),
      Type.Literal("equalHeight"),
      Type.Literal("equalWidth"),
    ]),
    panelIds: Type.Array(UuidSchema, { minItems: 2, uniqueItems: true }),
  },
  {
    description:
      "row: equal top y. equalHeight: equal visible-frame height. equalWidth: equal visible-frame width. Not a scientific scale.",
  },
);

export const CanvasSchema = object({
  widthMm: PositiveMmSchema,
  heightMm: PositiveMmSchema,
  heightMode: Type.Union([Type.Literal("auto"), Type.Literal("fixed")], {
    description:
      "auto affects the next automatic layout only. heightMm is always the current height and does not grow during a manual drag.",
  }),
  background: Type.Literal("#FFFFFF"),
  marginsMm: object({
    top: NonNegativeMmSchema,
    right: NonNegativeMmSchema,
    bottom: NonNegativeMmSchema,
    left: NonNegativeMmSchema,
  }),
});

export const GutterMmSchema = object({
  horizontal: NonNegativeMmSchema,
  vertical: NonNegativeMmSchema,
});

export const LayoutSettingsSchema = object(
  {
    gutterMm: GutterMmSchema,
    primaryPanelId: Type.Union([UuidSchema, Type.Null()], {
      description: "null means unset. A primary panel is an ungrouped panel.",
    }),
    minPanelSizeMm: object({
      width: PositiveMmSchema,
      height: PositiveMmSchema,
    }),
    preferredHeightMm: PositiveMmSchema,
    maxAutoHeightMm: PositiveMmSchema,
    targetRasterPpi: Type.Number({ exclusiveMinimum: 0 }),
    constraints: Type.Array(LayoutConstraintSchema),
  },
  { description: "Layout settings. Replacing them does not run layout." },
);

export const FigureDocumentSchema = object(
  {
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    canvas: CanvasSchema,
    panels: uuidKeyed(PanelSchema, {
      maxProperties: RESOURCE_LIMITS.maxPanelsPerProject,
      description: "Keyed by panelId. The id is not repeated on the value.",
    }),
    panelOrder: Type.Array(UuidSchema, {
      uniqueItems: true,
      maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
      description: "Label order. Exact permutation of the panel ids.",
    }),
    stackOrder: Type.Array(UuidSchema, {
      uniqueItems: true,
      maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
      description: "Paint order. Later ids paint above earlier ids. Not the label order.",
    }),
    groups: uuidKeyed(PanelGroupSchema, {
      description: "Keyed by groupId. The id is not repeated on the value.",
    }),
    labelStyle: LabelStyleSchema,
    layoutSettings: LayoutSettingsSchema,
  },
  {
    description:
      "The only figure document model. Client theme, language, zoom, selection, and API keys are not fields.",
  },
);

export type LabelPlacement = Static<typeof LabelPlacementSchema>;
export type LabelSequence = Static<typeof LabelSequenceSchema>;
export type LabelFormat = Static<typeof LabelFormatSchema>;
export type LabelTypography = Static<typeof LabelTypographySchema>;
export type LabelStyle = Static<typeof LabelStyleSchema>;
export type LabelOverrides = Static<typeof LabelOverridesSchema>;
export type Panel = Static<typeof PanelSchema>;
export type PanelGroup = Static<typeof PanelGroupSchema>;
export type LayoutConstraint = Static<typeof LayoutConstraintSchema>;
export type FigureDocumentV1 = Static<typeof FigureDocumentSchema>;
