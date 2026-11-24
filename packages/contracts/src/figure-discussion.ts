import Type, { type Static } from "typebox";
import { RESOURCE_LIMITS } from "./constants.js";
import { FigurePickSchema, PublicationContextSchema } from "./document.js";
import { FigureReadingSchema } from "./figure-reading.js";
import { UuidSchema, RevisionSchema } from "./primitives.js";
import { object } from "./schema.js";

const locale = Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]);
const answers = Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 3, uniqueItems: true });
const promotionText = {
  question: Type.String({ minLength: 1, maxLength: 180 }),
  accept: Type.String({ minLength: 1, maxLength: 75 }),
  keep: Type.String({ minLength: 1, maxLength: 75 }),
  reason: Type.String({ minLength: 1, maxLength: 200 }),
};
export const OpeningTurnSchema = object({
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
  text: Type.String({ minLength: 1, maxLength: 1200 }),
});
export type OpeningTurn = Static<typeof OpeningTurnSchema>;
export const FigureBriefRequestSchema = object({
  turns: Type.Array(OpeningTurnSchema, { minItems: 1, maxItems: 12 }),
  locale,
  brief: Type.Optional(Type.String({ maxLength: 1000 })),
  configRevision: RevisionSchema,
});
export const FigureBriefReplySchema = object({
  kind: Type.Union([Type.Literal("question"), Type.Literal("ready")]),
  intent: Type.Union([Type.Literal("select"), Type.Literal("arrange"), Type.Literal("undecided")]),
  reply: Type.String({ minLength: 1, maxLength: 300 }),
  options: answers,
  request: Type.String({ minLength: 1, maxLength: 1000 }),
});
export type FigureBriefRequest = Static<typeof FigureBriefRequestSchema>;
export type FigureBriefReply = Static<typeof FigureBriefReplySchema>;
export const FigureDiscussionRequestSchema = object({
  assets: Type.Array(
    object({ id: UuidSchema, note: Type.String({ maxLength: 500 }), selected: Type.Boolean() }),
    { minItems: 1, maxItems: RESOURCE_LIMITS.maxAssetsPerProject },
  ),
  turns: Type.Array(Type.String({ maxLength: 1200 }), { minItems: 1, maxItems: 12 }),
  publication: PublicationContextSchema,
  locale,
  thumbnails: Type.Boolean(),
  configRevision: Type.Optional(RevisionSchema),
  curation: Type.Optional(object({
    allowQuestion: Type.Boolean(),
    layoutAll: Type.Optional(Type.Boolean()),
    focusRevision: Type.Optional(Type.Boolean({
      description: "Revise emphasis and reading order. Selected assets are existing main panels and the others are existing supplementary panels.",
    })),
  })),
});
export const FigureDiscussionReplySchema = object({
  kind: Type.Union([Type.Literal("question"), Type.Literal("proposal")]),
  reply: Type.String({ minLength: 1, maxLength: 1000 }),
  options: Type.Optional(answers),
  rows: Type.Array(Type.Array(UuidSchema, { minItems: 1, maxItems: 3 }), { maxItems: RESOURCE_LIMITS.maxPanelsPerProject }),
  picks: Type.Array(FigurePickSchema, { maxItems: RESOURCE_LIMITS.maxPanelsPerProject }),
  supplementary: Type.Optional(Type.Array(FigurePickSchema, { maxItems: RESOURCE_LIMITS.maxPanelsPerProject })),
  suggestedSupplementary: Type.Optional(Type.Array(FigurePickSchema, {
    maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
    description: "Optional suggestions concerning current main panels. These panels are still present in picks and rows.",
  })),
  promotion: Type.Optional(object({ id: UuidSchema, ...promotionText }, {
    description: "A question about bringing one existing supplementary panel into the main figure. The author must choose before any layout change.",
  })),
  primaryId: Type.Optional(UuidSchema),
  identity: Type.Optional(FigureReadingSchema),
});
export type FigureDiscussionRequest = Static<typeof FigureDiscussionRequestSchema>;
export type FigureDiscussionReply = Static<typeof FigureDiscussionReplySchema>;

// The visual provider speaks in the candidate numbers shown to the author.
const candidateNumber = Type.Integer({ minimum: 1, maximum: RESOURCE_LIMITS.maxAssetsPerProject });
const planPanel = object({ number: candidateNumber, reason: Type.String({ minLength: 1, maxLength: 200 }) });
export const CurationPromotionSchema = object({
  promotion: Type.Union([Type.Null(), object({ number: candidateNumber, ...promotionText })]),
});
const mainNumbers = Type.Array(candidateNumber, { minItems: 1, maxItems: RESOURCE_LIMITS.maxPanelsPerProject, uniqueItems: true });
const decision = Type.Union([Type.Null(), object({
  question: Type.String({ minLength: 1, maxLength: 180 }),
  options: Type.Array(object({ label: Type.String({ minLength: 1, maxLength: 75 }), main: mainNumbers }),
    { minItems: 2, maxItems: 3 }),
})]);
export const CurationDecisionSchema = object({ decision });
export type CurationDecision = Static<typeof decision>;
export const CurationPlanSchema = object({
  summary: Type.String({ minLength: 1, maxLength: 240 }),
  primaryNumber: Type.Optional(candidateNumber),
  main: Type.Array(planPanel, { minItems: 1, maxItems: RESOURCE_LIMITS.maxPanelsPerProject }),
  supplementary: Type.Array(planPanel, { maxItems: RESOURCE_LIMITS.maxPanelsPerProject }),
  suggestedSupplementary: Type.Optional(Type.Array(planPanel, { maxItems: RESOURCE_LIMITS.maxPanelsPerProject })),
  rows: Type.Array(Type.Array(candidateNumber, { minItems: 1, maxItems: 3 }), {
    minItems: 1, maxItems: RESOURCE_LIMITS.maxPanelsPerProject,
  }),
  decision,
});
