import Type, { type Static } from "typebox";
import { LAYOUT_SCORE_WEIGHTS } from "./constants.js";
import { NonEmptyStringSchema, NonNegativeMmSchema, PositiveMmSchema, UuidSchema } from "./primitives.js";
import { nullable, object } from "./schema.js";

export const LayoutFamilySchema = Type.Union(
  [
    Type.Literal("auto"),
    Type.Literal("rows"),
    Type.Literal("hero-top"),
    Type.Literal("hero-left"),
  ],
  {
    description:
      "rows: 1–3 units per row. hero-top: primary on the top row. hero-left: primary on the left. auto searches the applicable families. Layout order does not change labels.",
  },
);

export const UnitIdSchema = Type.Union([
  Type.String({
    pattern:
      "^panel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  }),
  Type.String({
    pattern:
      "^group:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
  }),
]);

export const CanvasOverrideSchema = object({
  widthMm: Type.Optional(PositiveMmSchema),
  heightMm: Type.Optional(PositiveMmSchema),
  heightMode: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("fixed")]),
  ),
});

export const GutterOverrideSchema = object({
  horizontal: NonNegativeMmSchema,
  vertical: NonNegativeMmSchema,
});

const layoutRequestFields = {
  family: LayoutFamilySchema,
  primaryPanelId: Type.Optional(UuidSchema),
  canvasOverride: Type.Optional(CanvasOverrideSchema),
  gutterOverrideMm: Type.Optional(GutterOverrideSchema),
};

export const LayoutRequestByOrderSchema = object(
  {
    ...layoutRequestFields,
    orderedUnitIds: Type.Array(UnitIdSchema, { minItems: 1 }),
  },
  { description: "orderedUnitIds is set and rows is absent." },
);

export const LayoutRequestByRowsSchema = object(
  {
    ...layoutRequestFields,
    rows: Type.Array(Type.Array(UnitIdSchema, { minItems: 1, maxItems: 3 }), {
      minItems: 1,
      description:
        "Hero rows describe only the secondary region. Each row has 1 to 3 units.",
    }),
  },
  { description: "rows is set and orderedUnitIds is absent." },
);

export const LayoutRequestDefaultOrderSchema = object(layoutRequestFields, {
  description: "Neither orderedUnitIds nor rows. Order comes from panelOrder.",
});

export const LayoutRequestSchema = Type.Union(
  [
    LayoutRequestByOrderSchema,
    LayoutRequestByRowsSchema,
    LayoutRequestDefaultOrderSchema,
  ],
  {
    description:
      "At most one of orderedUnitIds and rows. primaryPanelId is omitted when the request does not set one; the stored setting uses null instead.",
  },
);

const UnitPenaltySchema = Type.Union([
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Literal("unknown"),
]);

export const LayoutScoreSchema = object(
  {
    scoringVersion: NonEmptyStringSchema,
    penalties: object({
      readability: UnitPenaltySchema,
      whitespace: UnitPenaltySchema,
      emphasis: UnitPenaltySchema,
      consistency: UnitPenaltySchema,
      height: UnitPenaltySchema,
      movement: UnitPenaltySchema,
    }),
    total: nullable(Type.Number({ minimum: 0, maximum: 1 })),
  },
  {
    description:
      "Storage shape for candidates.scoreJson. Not part of the public Candidate. Unknown penalties are dropped and LAYOUT_SCORE_WEIGHTS is renormalized. total is null when every penalty is unknown.",
  },
);

export const LAYOUT_SCORE_WEIGHT_SUM =
  LAYOUT_SCORE_WEIGHTS.readability +
  LAYOUT_SCORE_WEIGHTS.whitespace +
  LAYOUT_SCORE_WEIGHTS.emphasis +
  LAYOUT_SCORE_WEIGHTS.consistency +
  LAYOUT_SCORE_WEIGHTS.height +
  LAYOUT_SCORE_WEIGHTS.movement;

export type LayoutRequest = Static<typeof LayoutRequestSchema>;
export type LayoutScore = Static<typeof LayoutScoreSchema>;
export type UnitId = Static<typeof UnitIdSchema>;
