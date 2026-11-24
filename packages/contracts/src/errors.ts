import Type, { type Static } from "typebox";
import { NonEmptyStringSchema, RevisionSchema, UuidSchema } from "./primitives.js";
import { object } from "./schema.js";

export const ErrorCodeSchema = Type.Union([
  Type.Literal("REQUEST_INVALID"),
  Type.Literal("NOT_FOUND"),
  Type.Literal("PROJECT_DELETED"),
  Type.Literal("REVISION_CONFLICT"),
  Type.Literal("CANDIDATE_STALE"),
  Type.Literal("AI_CONTEXT_INVALID"),
  Type.Literal("AI_SCOPE_VIOLATION"),
  Type.Literal("AI_CHAIN_LIMIT"),
  Type.Literal("TEXT_METRICS_UNAVAILABLE"),
  Type.Literal("IDEMPOTENCY_KEY_REUSED"),
  Type.Literal("ASSET_IN_USE"),
  Type.Literal("FILE_TOO_LARGE"),
  Type.Literal("UNSUPPORTED_MEDIA_TYPE"),
  Type.Literal("DOCUMENT_INVALID"),
  Type.Literal("LOCKED_ELEMENT"),
  Type.Literal("GROUP_PARTIAL_EDIT"),
  Type.Literal("OUTSIDE_CANVAS"),
  Type.Literal("LAYOUT_CONFLICT"),
  Type.Literal("SVG_UNSUPPORTED_FEATURE"),
  Type.Literal("FONT_MISSING"),
  Type.Literal("EXPORT_TOO_LARGE"),
  Type.Literal("PROVIDER_NOT_CONFIGURED"),
  Type.Literal("PROVIDER_CONFIG_CHANGED"),
  Type.Literal("MODEL_OUTPUT_INVALID"),
  Type.Literal("SPEECH_UNAVAILABLE"),
  Type.Literal("SERVER_RESTARTED"),
]);

export type ErrorCode = Static<typeof ErrorCodeSchema>;

/**
 * HTTP status is null when the handbook gives a job or diagnostic scene
 * instead of an HTTP status. Those codes stay in this one catalog.
 */
export const ERROR_CODES: Record<
  ErrorCode,
  { httpStatus: number | null; scene: string }
> = {
  REQUEST_INVALID: { httpStatus: 400, scene: "invalid field format" },
  NOT_FOUND: { httpStatus: 404, scene: "not found" },
  PROJECT_DELETED: { httpStatus: 409, scene: "project is soft-deleted" },
  REVISION_CONFLICT: { httpStatus: 409, scene: "document revision conflict" },
  CANDIDATE_STALE: { httpStatus: 409, scene: "candidate is stale" },
  AI_CONTEXT_INVALID: { httpStatus: 422, scene: "invalid draft or clarification context" },
  AI_SCOPE_VIOLATION: { httpStatus: 422, scene: "change outside the frozen selection" },
  AI_CHAIN_LIMIT: { httpStatus: 422, scene: "draft turn or cumulative command limit reached" },
  TEXT_METRICS_UNAVAILABLE: { httpStatus: 422, scene: "label cannot be measured using the specified font" },
  IDEMPOTENCY_KEY_REUSED: {
    httpStatus: 409,
    scene: "idempotency key reused for a different request",
  },
  ASSET_IN_USE: {
    httpStatus: 409,
    scene: "asset is referenced by the current document",
  },
  FILE_TOO_LARGE: { httpStatus: 413, scene: "upload exceeds the size limit" },
  UNSUPPORTED_MEDIA_TYPE: {
    httpStatus: 415,
    scene: "media type is not supported",
  },
  DOCUMENT_INVALID: { httpStatus: 422, scene: "document failed validation" },
  LOCKED_ELEMENT: { httpStatus: 422, scene: "element is locked" },
  GROUP_PARTIAL_EDIT: {
    httpStatus: 422,
    scene: "edit group was partially edited",
  },
  OUTSIDE_CANVAS: {
    httpStatus: 422,
    scene: "visible content or label is outside the canvas",
  },
  LAYOUT_CONFLICT: {
    httpStatus: 422,
    scene: "layout constraints have no solution",
  },
  SVG_UNSUPPORTED_FEATURE: { httpStatus: null, scene: "import job error" },
  FONT_MISSING: { httpStatus: null, scene: "usually a warning" },
  EXPORT_TOO_LARGE: { httpStatus: 422, scene: "export exceeds the output limit" },
  PROVIDER_NOT_CONFIGURED: { httpStatus: null, scene: "AI request error" },
  PROVIDER_CONFIG_CHANGED: { httpStatus: null, scene: "AI job error" },
  MODEL_OUTPUT_INVALID: { httpStatus: null, scene: "AI job error" },
  SPEECH_UNAVAILABLE: { httpStatus: 502, scene: "speech transcription provider unavailable" },
  SERVER_RESTARTED: { httpStatus: null, scene: "unfinished job error" },
};

export const ApiErrorDetailsSchema = object(
  {
    reason: Type.Optional(Type.Union([
      Type.Literal("region-occupied"), Type.Literal("region-too-small"),
      Type.Literal("cross-selection-constraint"), Type.Literal("group-resize"),
      Type.Literal("outside-layout-conflict"), Type.Literal("invalid-units"),
      Type.Literal("region-outside-margins"), Type.Literal("missing-glyph"),
      Type.Literal("layout-margin"), Type.Literal("layout-overlap"), Type.Literal("layout-min-size"),
      Type.Literal("layout-constraint"), Type.Literal("layout-max-height"),
      Type.Literal("unsupported-text-layout"), Type.Literal("turn-limit"),
      Type.Literal("command-limit"), Type.Literal("empty-selection"),
      Type.Literal("scope-conflict"), Type.Literal("reader-busy"), Type.Literal("vision-unavailable"), Type.Literal("reading-failed"),
      Type.Literal("reference-slots"), Type.Literal("reference-structure"), Type.Literal("guided-preferences"),
    ])),
    expectedRevision: Type.Optional(RevisionSchema),
    actualRevision: Type.Optional(RevisionSchema),
    panelIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
    assetIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
    constraintIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
  },
  {
    description:
      "Closed details object. Revision conflicts use expectedRevision and actualRevision. Document errors may include ids so the client can point at a panel.",
  },
);

export const ApiErrorSchema = object({
  error: object({
    code: ErrorCodeSchema,
    message: NonEmptyStringSchema,
    requestId: NonEmptyStringSchema,
    details: ApiErrorDetailsSchema,
  }),
});

export type ApiError = Static<typeof ApiErrorSchema>;
