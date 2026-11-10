import Type, { type Static, type TSchema } from "typebox";
import { CandidateSchema } from "./candidate.js";
import { JOB_EVENT_NAMES } from "./constants.js";
import { DiagnosticSchema } from "./diagnostics.js";
import { ErrorCodeSchema } from "./errors.js";
import {
  DateTimeSchema,
  ExportFormatSchema,
  NonEmptyStringSchema,
  RevisionSchema,
  UuidSchema,
} from "./primitives.js";
import { StructuredOutputSchema } from "./ai.js";
import { nullable, object } from "./schema.js";

export const ProgressSchema = object({
  completed: Type.Integer({ minimum: 0 }),
  total: Type.Integer({ minimum: 0 }),
});

export const JobErrorSchema = object({
  code: ErrorCodeSchema,
  message: NonEmptyStringSchema,
});

export const AssetImportResultSchema = object({ assetId: UuidSchema });

export const PreviewJobResultSchema = object({ artifactId: UuidSchema });

export const ExportJobResultSchema = object({
  artifactId: UuidSchema,
  revision: RevisionSchema,
  format: ExportFormatSchema,
  diagnostics: Type.Array(DiagnosticSchema),
});

export const ProjectImportJobResultSchema = object({
  projectId: UuidSchema,
  revision: Type.Literal(0),
});

export const ProviderTestJobResultSchema = object({
  latencyMs: Type.Integer({ minimum: 0 }),
  observedCapabilities: object({
    imageInput: Type.Boolean(),
    structuredOutput: StructuredOutputSchema,
  }),
});

export const AILayoutJobResultSchema = Type.Union([
  object({
    kind: Type.Literal("candidates"),
    candidates: Type.Array(CandidateSchema, { maxItems: 3 }),
  }),
  object({
    kind: Type.Literal("clarification"),
    question: NonEmptyStringSchema,
    options: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1 })),
  }),
  object({
    kind: Type.Literal("unsupported"),
    reason: NonEmptyStringSchema,
  }),
]);

export const JobResultSchema = Type.Union([
  AssetImportResultSchema,
  PreviewJobResultSchema,
  ExportJobResultSchema,
  ProjectImportJobResultSchema,
  ProviderTestJobResultSchema,
  AILayoutJobResultSchema,
]);

function jobSchema<Kind extends string, Result extends TSchema>(kind: Kind, result: Result) {
  const shared = {
    id: UuidSchema,
    projectId: nullable(UuidSchema),
    kind: Type.Literal(kind),
    phase: NonEmptyStringSchema,
    progress: nullable(ProgressSchema),
    createdAt: DateTimeSchema,
    startedAt: nullable(DateTimeSchema),
  };
  return Type.Union([
    object({
      ...shared,
      status: Type.Literal("queued"),
      finishedAt: Type.Null(),
      result: Type.Null(),
      error: Type.Null(),
    }),
    object({
      ...shared,
      status: Type.Literal("running"),
      finishedAt: Type.Null(),
      result: Type.Null(),
      error: Type.Null(),
    }),
    object({
      ...shared,
      status: Type.Literal("succeeded"),
      finishedAt: DateTimeSchema,
      result,
      error: Type.Null(),
    }),
    object({
      ...shared,
      status: Type.Literal("failed"),
      finishedAt: DateTimeSchema,
      result: Type.Null(),
      error: JobErrorSchema,
    }),
    object({
      ...shared,
      status: Type.Literal("cancelled"),
      finishedAt: DateTimeSchema,
      result: Type.Null(),
      error: Type.Null(),
    }),
  ]);
}

export const JobSchema = Type.Union([
  jobSchema("asset_import", AssetImportResultSchema),
  jobSchema("ai_layout", AILayoutJobResultSchema),
  jobSchema("preview", PreviewJobResultSchema),
  jobSchema("export", ExportJobResultSchema),
  jobSchema("project_import", ProjectImportJobResultSchema),
  jobSchema("provider_test", ProviderTestJobResultSchema),
]);

export const JobAcceptedSchema = object({ jobId: UuidSchema });

export const JobEventNameSchema = Type.Union([
  Type.Literal(JOB_EVENT_NAMES[0]),
  Type.Literal(JOB_EVENT_NAMES[1]),
  Type.Literal(JOB_EVENT_NAMES[2]),
  Type.Literal(JOB_EVENT_NAMES[3]),
  Type.Literal(JOB_EVENT_NAMES[4]),
  Type.Literal(JOB_EVENT_NAMES[5]),
]);

export const JobEventDataSchema = object(
  {
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    phase: NonEmptyStringSchema,
    progress: nullable(ProgressSchema),
  },
  {
    description:
      "SSE data payload. Clients load the job for the result. A comment heartbeat is sent every 15 seconds.",
  },
);

export type Job = Static<typeof JobSchema>;
export type JobResult = Static<typeof JobResultSchema>;
export type AILayoutJobResult = Static<typeof AILayoutJobResultSchema>;
