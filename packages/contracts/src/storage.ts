import Type from "typebox";
import { AIProviderConfigSchema } from "./ai.js";
import { AssetSchema } from "./assets.js";
import { DomainCommandSchema } from "./commands.js";
import { DiagnosticSchema } from "./diagnostics.js";
import { FigureDocumentSchema } from "./document.js";
import {
  DateTimeSchema,
  DocumentHashSchema,
  IdempotencyKeySchema,
  NonEmptyStringSchema,
  ProjectTitleSchema,
  RevisionSchema,
  Sha256Schema,
  UuidSchema,
} from "./primitives.js";
import { LayoutScoreSchema } from "./layout.js";
import { JobErrorSchema, JobEventDataSchema, JobEventNameSchema, JobResultSchema } from "./jobs.js";
import { nullable, object } from "./schema.js";

export const ProjectRowSchema = object(
  {
    id: UuidSchema,
    title: ProjectTitleSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    deletedAt: nullable(DateTimeSchema),
    currentRevision: RevisionSchema,
    undoStackJson: Type.Unknown(),
    redoStackJson: Type.Unknown(),
  },
  {
    description:
      "undoStackJson and redoStackJson have no handbook JSON shape. They stay unconstrained. Suggested encoding, not enforced: revision numbers, oldest first.",
  },
);

export const ProjectRevisionRowSchema = object(
  {
    projectId: UuidSchema,
    revision: RevisionSchema,
    baseRevision: nullable(RevisionSchema),
    kind: NonEmptyStringSchema,
    documentJson: FigureDocumentSchema,
    documentHash: DocumentHashSchema,
    commandsJson: Type.Array(DomainCommandSchema),
    transactionId: nullable(UuidSchema),
    targetRevision: nullable(RevisionSchema),
    engineVersion: NonEmptyStringSchema,
    createdAt: DateTimeSchema,
  },
  {
    description:
      "Primary key is (projectId, revision). documentJson is immutable. kind is an open string. commandsJson is empty when the revision has no domain commands. baseRevision and targetRevision are null when they do not apply.",
  },
);

export const CandidateRowSchema = object(
  {
    id: UuidSchema,
    projectId: UuidSchema,
    baseRevision: RevisionSchema,
    origin: Type.Union([Type.Literal("layout"), Type.Literal("ai")]),
    validationMode: Type.Union([Type.Literal("edit"), Type.Literal("layout")]),
    commandsJson: Type.Array(DomainCommandSchema),
    resultDocumentHash: DocumentHashSchema,
    summary: NonEmptyStringSchema,
    diagnosticsJson: Type.Array(DiagnosticSchema),
    scoreJson: LayoutScoreSchema,
    engineVersion: NonEmptyStringSchema,
    fontRegistryVersion: NonEmptyStringSchema,
    createdAt: DateTimeSchema,
  },
  {
    description:
      "Stored candidate. previewDocument is not a column; the API derives it. scoreJson is not part of the public Candidate object.",
  },
);

export const AssetRowSchema = AssetSchema;

export const JobRowSchema = object(
  {
    id: UuidSchema,
    projectId: nullable(UuidSchema),
    kind: Type.Union([
      Type.Literal("asset_import"),
      Type.Literal("ai_layout"),
      Type.Literal("preview"),
      Type.Literal("export"),
      Type.Literal("project_import"),
      Type.Literal("provider_test"),
    ]),
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    phase: NonEmptyStringSchema,
    inputJson: Type.Unknown(),
    resultJson: nullable(JobResultSchema),
    errorJson: nullable(JobErrorSchema),
    cancelRequested: Type.Boolean(),
    createdAt: DateTimeSchema,
    startedAt: nullable(DateTimeSchema),
    finishedAt: nullable(DateTimeSchema),
  },
  {
    description:
      "Storage row from the jobs table. Progress is an API and SSE field, not a column. The public Job schema is the stricter status state machine.",
  },
);

export const JobEventRowSchema = object({
  jobId: UuidSchema,
  seq: Type.Integer({ minimum: 0 }),
  event: JobEventNameSchema,
  payloadJson: JobEventDataSchema,
  createdAt: DateTimeSchema,
});

export const ArtifactRowSchema = object(
  {
    id: UuidSchema,
    projectId: UuidSchema,
    revision: nullable(RevisionSchema),
    candidateId: nullable(UuidSchema),
    kind: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    filename: NonEmptyStringSchema,
    byteLength: Type.Integer({ minimum: 0 }),
    sha256: Sha256Schema,
    blobPath: NonEmptyStringSchema,
    rendererVersion: NonEmptyStringSchema,
    createdAt: DateTimeSchema,
  },
  {
    description:
      "blobPath is internal and must not appear in API responses. revision and candidateId are nullable because a row is not always both an export and a candidate preview.",
  },
);

export const ProviderSettingsRowSchema = object(
  {
    configRevision: RevisionSchema,
    config: AIProviderConfigSchema,
    encryptedSecret: nullable(NonEmptyStringSchema),
    updatedAt: DateTimeSchema,
  },
  {
    description:
      "One current provider configuration. encryptedSecret is authenticated ciphertext and is never returned by the API.",
  },
);

export const IdempotencyRowSchema = object({
  scope: NonEmptyStringSchema,
  key: IdempotencyKeySchema,
  requestHash: NonEmptyStringSchema,
  httpStatus: Type.Integer({ minimum: 100, maximum: 599 }),
  responseJson: Type.Unknown(),
  createdAt: DateTimeSchema,
});
