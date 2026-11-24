import Type, { type Static } from "typebox";
import { RESOURCE_LIMITS } from "./constants.js";
import { UuidSchema, Sha256Schema, RevisionSchema } from "./primitives.js";
import { object, nullable } from "./schema.js";

export const figureKinds = {
  scatter: ["散点图", "Scatter plot"],
  line: ["折线图", "Line plot"],
  bar: ["柱状图", "Bar chart"],
  box: ["箱线图", "Box plot"],
  violin: ["小提琴图", "Violin plot"],
  histogram: ["直方图", "Histogram"],
  heatmap: ["热图", "Heatmap"],
  embedding: ["降维图", "Embedding"],
  volcano: ["火山图", "Volcano plot"],
  survival: ["生存曲线", "Survival curve"],
  microscopy: ["显微图", "Micrograph"],
  blot: ["印迹或凝胶图", "Blot or gel"],
  diagram: ["示意图", "Diagram"],
  table: ["表格", "Table"],
  composite: ["多面板图", "Composite figure"],
  unknown: ["类型待定", "Undetermined"],
} as const;
export type FigureKind = keyof typeof figureKinds;
export const FigureKindSchema = Type.Union([
  Type.Literal("scatter"),
  Type.Literal("line"),
  Type.Literal("bar"),
  Type.Literal("box"),
  Type.Literal("violin"),
  Type.Literal("histogram"),
  Type.Literal("heatmap"),
  Type.Literal("embedding"),
  Type.Literal("volcano"),
  Type.Literal("survival"),
  Type.Literal("microscopy"),
  Type.Literal("blot"),
  Type.Literal("diagram"),
  Type.Literal("table"),
  Type.Literal("composite"),
  Type.Literal("unknown"),
]);
export function figureKindLabel(kind: FigureKind, locale: string) {
  return figureKinds[kind][locale.startsWith("zh") ? 0 : 1];
}
const confidence = Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]);
const texts = Type.Array(Type.String({ minLength: 1, maxLength: 180 }), { maxItems: 48 });
export const LocalFigureEvidenceSchema = object({
  category: FigureKindSchema,
  confidence,
  svgText: texts,
  ocrText: texts,
  ocrStatus: Type.Union([
    Type.Literal("not-needed"),
    Type.Literal("read"),
    Type.Literal("empty"),
    Type.Literal("unavailable"),
  ]),
  cues: Type.Array(Type.String({ maxLength: 180 }), { maxItems: 8 }),
});
export const VisualObservationSchema = object({
  id: UuidSchema,
  category: FigureKindSchema,
  confidence,
  text: texts,
  observation: Type.String({ minLength: 1, maxLength: 450 }),
});
export const VisualBatchSchema = object({
  items: Type.Array(VisualObservationSchema, { minItems: 1, maxItems: 3 }),
});
export const NameConflictSchema = object({
  nameQuote: Type.String({ minLength: 1, maxLength: 180 }),
  imageQuote: Type.String({ minLength: 1, maxLength: 180 }),
});
export const NameCheckSchema = object({
  conflicts: Type.Array(
    object({
      id: UuidSchema,
      nameQuote: Type.String({ minLength: 1, maxLength: 180 }),
      imageQuote: Type.String({ minLength: 1, maxLength: 180 }),
    }),
    { maxItems: 3 },
  ),
});
const choice = Type.Union([Type.Literal("image"), Type.Literal("filename"), Type.Literal("custom")]);
export const FigureIdentitySchema = object({ choice, value: Type.String({ minLength: 1, maxLength: 300 }) });
export const FigureReadingSchema = object({
  id: UuidSchema,
  fingerprint: Sha256Schema,
  source: Type.Union([Type.Literal("local"), Type.Literal("vision")]),
  local: LocalFigureEvidenceSchema,
  category: FigureKindSchema,
  confidence,
  text: texts,
  observation: Type.String({ maxLength: 450 }),
  conflict: nullable(NameConflictSchema),
  decision: nullable(FigureIdentitySchema),
});
export const PanelReadingClueSchema = object({
  panelId: UuidSchema,
  category: FigureKindSchema,
  source: Type.Union([Type.Literal("local"), Type.Literal("vision")]),
  visibleText: Type.Array(Type.String({ maxLength: 180 }), { maxItems: 20 }),
  observation: Type.String({ maxLength: 450 }),
  authorMeaning: nullable(Type.String({ maxLength: 300 })),
});
export type PanelReadingClue = Static<typeof PanelReadingClueSchema>;
export const FigureReadingsRequestSchema = object({
  assetIds: Type.Array(UuidSchema, {
    minItems: 1,
    maxItems: RESOURCE_LIMITS.maxAssetsPerProject,
    uniqueItems: true,
  }),
  vision: Type.Boolean(),
  configRevision: Type.Optional(RevisionSchema),
  preferSaved: Type.Optional(Type.Boolean()),
  locale: Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]),
});
export const FigureReadingsResponseSchema = object({
  items: Type.Array(FigureReadingSchema, { maxItems: RESOURCE_LIMITS.maxAssetsPerProject }),
});
export const ConfirmFigureIdentitySchema = object({
  fingerprint: Sha256Schema,
  choice,
  value: Type.String({ minLength: 1, maxLength: 300 }),
});
export type LocalFigureEvidence = Static<typeof LocalFigureEvidenceSchema>;
export type VisualObservation = Static<typeof VisualObservationSchema>;
export type NameConflict = Static<typeof NameConflictSchema>;
export type FigureReading = Static<typeof FigureReadingSchema>;
export type FigureReadingsRequest = Static<typeof FigureReadingsRequestSchema>;
export type ConfirmFigureIdentity = Static<typeof ConfirmFigureIdentitySchema>;
