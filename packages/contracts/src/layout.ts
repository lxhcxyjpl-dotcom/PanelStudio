import Type, { type Static } from "typebox";
import { LAYOUT_SCORE_WEIGHTS } from "./constants.js";
import { NonEmptyStringSchema, NonNegativeMmSchema, PositiveMmSchema, RectMmSchema, UuidSchema } from "./primitives.js";
import { nullable, object } from "./schema.js";
import type { FigureDocumentV1 } from "./document.js";

const GlobalLayoutFamilySchema = Type.Union(
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
export const LayoutFamilySchema = Type.Union([GlobalLayoutFamilySchema, Type.Literal("selection-row"), Type.Literal("guided")]);

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
  family: GlobalLayoutFamilySchema,
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

export const SelectionRowLayoutRequestSchema = object({
  family: Type.Literal("selection-row"),
  orderedUnitIds: Type.Array(UnitIdSchema, { minItems: 2, maxItems: 3, uniqueItems: true }),
  sizing: Type.Union([Type.Literal("preserve"), Type.Literal("equal-width"), Type.Literal("equal-height")]),
  regionMm: Type.Optional(RectMmSchema),
  gapMm: Type.Optional(NonNegativeMmSchema),
});

const standardRequests = [LayoutRequestByOrderSchema, LayoutRequestByRowsSchema,
  LayoutRequestDefaultOrderSchema, SelectionRowLayoutRequestSchema] as const;
const requestOptions = { description:
  "At most one of orderedUnitIds and rows. primaryPanelId is omitted when the request does not set one; the stored setting uses null instead." };
export const StandardLayoutRequestSchema = Type.Union([...standardRequests], requestOptions);

const coordinate = Type.Number({ minimum: 0, maximum: 1 });
const extent = Type.Number({ exclusiveMinimum: 0, maximum: 1 });
const GuidedPreferencesSchema = object({
  gapMm: Type.Optional(Type.Number({ minimum: 0, maximum: 30 })),
  shape: Type.Optional(Type.Union([Type.Literal("wide"), Type.Literal("tall"), Type.Literal("square")])),
  focus: Type.Optional(UnitIdSchema),
  pair: Type.Optional(object({
    first: UnitIdSchema, second: UnitIdSchema,
    axis: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical"), Type.Literal("any")]),
  })),
});
export const GuidedLayoutRequestSchema = object({
  family: Type.Literal("guided"),
  preferences: GuidedPreferencesSchema,
  referenceAspect: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1000 })),
  referenceSlots: Type.Optional(Type.Array(object({
    unitId: UnitIdSchema, x: coordinate, y: coordinate, width: extent, height: extent,
  }), { minItems: 2, maxItems: 8 })),
}, { description: "Reviewed reference regions in normalized image coordinates and explicit composition preferences." });
export const LayoutRequestSchema = Type.Union([...standardRequests, GuidedLayoutRequestSchema], requestOptions);

export type GuidedLayoutRequest = Static<typeof GuidedLayoutRequestSchema>;
export type GuidedPreferences = GuidedLayoutRequest["preferences"];
export type ReferenceSlot = NonNullable<GuidedLayoutRequest["referenceSlots"]>[number];

/** Groups count as one reference slot at their first panel in label order. */
export function layoutUnitIds(document: FigureDocumentV1): string[] {
  const groups = new Map(Object.entries(document.groups).flatMap(([groupId, group]) =>
    group.panelIds.map((id) => [id, "group:" + groupId] as const)));
  return [...new Set(document.panelOrder.map((id) => groups.get(id) ?? "panel:" + id))];
}

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
export type SelectionRowLayoutRequest = Static<typeof SelectionRowLayoutRequestSchema>;
export type LayoutScore = Static<typeof LayoutScoreSchema>;
export type UnitId = Static<typeof UnitIdSchema>;
