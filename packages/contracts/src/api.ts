import Type, { type Static, type TSchema } from "typebox";
import { AIProviderSettingsSchema, type AIProviderConfig } from "./ai.js";
import { AssetSchema } from "./assets.js";
import { CandidateSchema } from "./candidate.js";
import { BUNDLED_FONTS, ENGINE_VERSIONS, RESOURCE_LIMITS, SCHEMA_VERSION } from "./constants.js";
import { HistoryFlagsSchema, TransactionRequestSchema, TransactionResponseSchema } from "./commands.js";
import { FigureDocumentSchema } from "./document.js";
import { LayoutRequestSchema } from "./layout.js";
import {
  DateTimeSchema,
  DocumentHashSchema,
  ExportFormatSchema,
  FontIdSchema,
  FontWeightSchema,
  IdempotencyKeySchema,
  ImportMediaTypeSchema,
  NonEmptyStringSchema,
  PngDpiSchema,
  ProjectTitleSchema,
  RevisionSchema,
  UuidSchema,
} from "./primitives.js";
import { object } from "./schema.js";

export const HealthResponseSchema = object({
  status: Type.Literal("ok"),
  appVersion: NonEmptyStringSchema,
  schemaVersion: Type.Literal(SCHEMA_VERSION),
});

export const FontInfoSchema = object({
  fontId: FontIdSchema,
  family: NonEmptyStringSchema,
  weights: Type.Array(FontWeightSchema, { minItems: 1, uniqueItems: true }),
  bundled: Type.Boolean(),
});

const limitCount = Type.Integer({ minimum: 1 });

export const ResourceLimitsSchema = object({
  maxPanelsPerProject: limitCount,
  maxAssetsPerProject: limitCount,
  maxUploadBytes: limitCount,
  maxOriginalAssetBytesPerProject: limitCount,
  maxRasterDecodePixels: limitCount,
  maxSvgElements: limitCount,
  maxCommandsPerTransaction: limitCount,
  maxAiPromptCharacters: limitCount,
  maxCustomLabelCharacters: limitCount,
  maxPngOutputPixels: limitCount,
  maxPngOutputEdgePx: limitCount,
  maxProjectPackageUncompressedBytes: limitCount,
  minAutoLayoutPanels: limitCount,
  maxAutoLayoutPanels: limitCount,
  maxLayoutCandidates: limitCount,
  aiModelCallBudget: limitCount,
});

export const CapabilitiesResponseSchema = object({
  formats: object({
    import: Type.Array(ImportMediaTypeSchema),
    export: Type.Array(ExportFormatSchema),
  }),
  limits: ResourceLimitsSchema,
  fonts: Type.Array(FontInfoSchema),
  engines: object({
    layout: NonEmptyStringSchema,
    svg: NonEmptyStringSchema,
    fontRegistry: NonEmptyStringSchema,
  }),
});

export const ProjectSchema = object({
  id: UuidSchema,
  title: ProjectTitleSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  deletedAt: Type.Union([DateTimeSchema, Type.Null()]),
  currentRevision: RevisionSchema,
});

export const ProjectWriteRequestSchema = object({
  title: ProjectTitleSchema,
});

export const CreateProjectResponseSchema = object({
  project: ProjectSchema,
  revision: Type.Literal(0),
});

export function pageSchema<Item extends TSchema>(item: Item) {
  return object({
    items: Type.Array(item),
    nextCursor: Type.Union([NonEmptyStringSchema, Type.Null()], {
      description: "null when there is no further page. Empty string is not a cursor.",
    }),
  });
}

export const ProjectPageSchema = pageSchema(ProjectSchema);
export const AssetPageSchema = pageSchema(AssetSchema);

export const DocumentStateSchema = object({
  projectId: UuidSchema,
  revision: RevisionSchema,
  document: FigureDocumentSchema,
  documentHash: DocumentHashSchema,
  history: HistoryFlagsSchema,
});

export const RevisionSummarySchema = object({
  projectId: UuidSchema,
  revision: RevisionSchema,
  baseRevision: Type.Union([RevisionSchema, Type.Null()]),
  kind: NonEmptyStringSchema,
  documentHash: DocumentHashSchema,
  createdAt: DateTimeSchema,
});

export const RevisionPageSchema = pageSchema(RevisionSummarySchema);

export const RevisionSnapshotSchema = object({
  projectId: UuidSchema,
  revision: RevisionSchema,
  baseRevision: Type.Union([RevisionSchema, Type.Null()]),
  kind: NonEmptyStringSchema,
  document: FigureDocumentSchema,
  documentHash: DocumentHashSchema,
  createdAt: DateTimeSchema,
});

export const HistoryRequestSchema = object({
  baseRevision: RevisionSchema,
});

export type HistoryRequest = Static<typeof HistoryRequestSchema>;

export const MaxCandidatesSchema = Type.Union(
  [Type.Literal(1), Type.Literal(2), Type.Literal(3)],
  { default: 3, description: "1, 2, or 3. Omitted means 3." },
);

export const LayoutCandidatesRequestSchema = object({
  baseRevision: RevisionSchema,
  request: LayoutRequestSchema,
  maxCandidates: Type.Optional(MaxCandidatesSchema),
});

export const LayoutCandidatesResponseSchema = object({
  candidates: Type.Array(CandidateSchema, {
    maxItems: RESOURCE_LIMITS.maxLayoutCandidates,
  }),
});

export const PreviewRequestSchema = object({
  source: Type.Union([
    object({ revision: RevisionSchema }),
    object({ candidateId: UuidSchema }),
  ]),
  pixelWidth: Type.Integer({
    minimum: 1,
    maximum: RESOURCE_LIMITS.maxPngOutputEdgePx,
    description: "Uses the PNG single-edge limit as the preview width cap.",
  }),
});

export const ExportRequestSchema = Type.Union([
  object({
    revision: RevisionSchema,
    format: Type.Literal("svg"),
    options: object({ includeMetadata: Type.Boolean() }),
  }),
  object({
    revision: RevisionSchema,
    format: Type.Literal("png"),
    options: object({ dpi: PngDpiSchema }),
  }),
  object({
    revision: RevisionSchema,
    format: Type.Literal("project"),
    options: object({ includeBundledFonts: Type.Boolean() }),
  }),
]);

export const FontListResponseSchema = object({
  fonts: Type.Array(FontInfoSchema),
});

export const QueryLimitSchema = Type.Integer({ minimum: 1, maximum: 100 });

export const IncludeDeletedSchema = Type.Boolean({ default: false });

export { IdempotencyKeySchema, TransactionRequestSchema, TransactionResponseSchema };

export const PHASE0_CAPABILITY_SAMPLE = {
  formats: {
    import: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    export: ["svg", "png", "project"],
  },
  limits: RESOURCE_LIMITS,
  fonts: BUNDLED_FONTS,
  engines: ENGINE_VERSIONS,
} as const;

export type HealthResponse = Static<typeof HealthResponseSchema>;
export type CapabilitiesResponse = Static<typeof CapabilitiesResponseSchema>;
export type Project = Static<typeof ProjectSchema>;
export type PreviewRequest = Static<typeof PreviewRequestSchema>;
export type ExportRequest = Static<typeof ExportRequestSchema>;
export type AIProviderSettings = Static<typeof AIProviderSettingsSchema>;
export type { AIProviderConfig };
