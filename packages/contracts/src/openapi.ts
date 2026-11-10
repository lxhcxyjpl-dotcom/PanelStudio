import Type, { type TSchema } from "typebox";
import {
  AIIntentSchema,
  AILayoutRequestSchema,
  AIProviderConfigSchema,
  AIProviderSettingsSchema,
  SecretDeleteResponseSchema,
  SecretWriteRequestSchema,
  SecretWriteResponseSchema,
} from "./ai.js";
import { AssetAcceptedSchema, AssetSchema } from "./assets.js";
import { CandidateSchema } from "./candidate.js";
import { APP_VERSION } from "./constants.js";
import { ApiErrorSchema } from "./errors.js";
import { JobAcceptedSchema, JobSchema } from "./jobs.js";
import { ProjectManifestSchema } from "./project-package.js";
import {
  AssetPageSchema,
  CapabilitiesResponseSchema,
  CreateProjectResponseSchema,
  DocumentStateSchema,
  ExportRequestSchema,
  FontListResponseSchema,
  HealthResponseSchema,
  HistoryRequestSchema,
  IncludeDeletedSchema,
  LayoutCandidatesRequestSchema,
  LayoutCandidatesResponseSchema,
  PreviewRequestSchema,
  ProjectPageSchema,
  ProjectSchema,
  ProjectWriteRequestSchema,
  QueryLimitSchema,
  RevisionPageSchema,
  RevisionSnapshotSchema,
  TransactionRequestSchema,
  TransactionResponseSchema,
} from "./api.js";
import {
  DateTimeSchema,
  DocumentHashSchema,
  IdempotencyKeySchema,
  NonEmptyStringSchema,
  RevisionSchema,
  UuidSchema,
} from "./primitives.js";
import { FigureDocumentSchema } from "./document.js";
import { DomainCommandSchema } from "./commands.js";
import { DiagnosticSchema } from "./diagnostics.js";
import { LayoutRequestSchema } from "./layout.js";

export function toJsonSchema(schema: TSchema): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

const componentSchemas = {
  ApiError: ApiErrorSchema,
  Uuid: UuidSchema,
  Revision: RevisionSchema,
  DateTime: DateTimeSchema,
  DocumentHash: DocumentHashSchema,
  IdempotencyKey: IdempotencyKeySchema,
  HealthResponse: HealthResponseSchema,
  CapabilitiesResponse: CapabilitiesResponseSchema,
  Project: ProjectSchema,
  ProjectWriteRequest: ProjectWriteRequestSchema,
  CreateProjectResponse: CreateProjectResponseSchema,
  ProjectPage: ProjectPageSchema,
  DocumentState: DocumentStateSchema,
  RevisionPage: RevisionPageSchema,
  RevisionSnapshot: RevisionSnapshotSchema,
  HistoryRequest: HistoryRequestSchema,
  TransactionRequest: TransactionRequestSchema,
  TransactionResponse: TransactionResponseSchema,
  Asset: AssetSchema,
  AssetPage: AssetPageSchema,
  AssetAccepted: AssetAcceptedSchema,
  LayoutCandidatesRequest: LayoutCandidatesRequestSchema,
  LayoutCandidatesResponse: LayoutCandidatesResponseSchema,
  Candidate: CandidateSchema,
  AILayoutRequest: AILayoutRequestSchema,
  PreviewRequest: PreviewRequestSchema,
  ExportRequest: ExportRequestSchema,
  AIProviderConfig: AIProviderConfigSchema,
  AIProviderSettings: AIProviderSettingsSchema,
  SecretWriteRequest: SecretWriteRequestSchema,
  SecretWriteResponse: SecretWriteResponseSchema,
  SecretDeleteResponse: SecretDeleteResponseSchema,
  FontListResponse: FontListResponseSchema,
  Job: JobSchema,
  JobAccepted: JobAcceptedSchema,
  FigureDocumentV1: FigureDocumentSchema,
  DomainCommand: DomainCommandSchema,
  Diagnostic: DiagnosticSchema,
  LayoutRequest: LayoutRequestSchema,
  AIIntent: AIIntentSchema,
  ProjectManifest: ProjectManifestSchema,
} as const;

type Method = "get" | "post" | "put" | "patch" | "delete";

type Operation = {
  operationId: string;
  method: Method;
  path: string;
  tags: string[];
  summary: string;
  parameters?: Record<string, unknown>[];
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
  idempotency?: boolean;
};

function ref(name: keyof typeof componentSchemas) {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonResponse(description: string, name: keyof typeof componentSchemas) {
  return {
    description,
    content: { "application/json": { schema: ref(name) } },
  };
}

function jsonBody(name: keyof typeof componentSchemas) {
  return {
    required: true,
    content: { "application/json": { schema: ref(name) } },
  };
}

function binaryContent(mediaTypes: string[]) {
  return Object.fromEntries(
    mediaTypes.map((mediaType) => [
      mediaType,
      { schema: { type: "string", format: "binary" } },
    ]),
  );
}

const errorResponse = {
  description: "Error envelope.",
  content: { "application/json": { schema: ref("ApiError") } },
};

const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: ref("IdempotencyKey"),
  description:
    "Unique request id. The same key and the same request return the first response. The same key and a different request return IDEMPOTENCY_KEY_REUSED.",
};

const projectId = {
  name: "projectId",
  in: "path",
  required: true,
  schema: ref("Uuid"),
};

const assetId = {
  name: "assetId",
  in: "path",
  required: true,
  schema: ref("Uuid"),
};

const candidateId = {
  name: "candidateId",
  in: "path",
  required: true,
  schema: ref("Uuid"),
};

const artifactId = {
  name: "artifactId",
  in: "path",
  required: true,
  schema: ref("Uuid"),
};

const jobId = {
  name: "jobId",
  in: "path",
  required: true,
  schema: ref("Uuid"),
};

const revision = {
  name: "revision",
  in: "path",
  required: true,
  schema: ref("Revision"),
};

const cursorQuery = {
  name: "cursor",
  in: "query",
  required: false,
  schema: toJsonSchema(NonEmptyStringSchema),
};

const limitQuery = {
  name: "limit",
  in: "query",
  required: false,
  schema: toJsonSchema(QueryLimitSchema),
  description: "Page size from 1 to 100. The handbook does not set a default.",
};

const includeDeletedQuery = {
  name: "includeDeleted",
  in: "query",
  required: false,
  schema: toJsonSchema(IncludeDeletedSchema),
};

const listQuery = [cursorQuery, limitQuery];

const fileUpload = {
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["file"],
        properties: {
          file: { type: "string", format: "binary" },
        },
      },
    },
  },
};

function withError(responses: Record<string, unknown>) {
  return { ...responses, default: errorResponse };
}

const operations: Operation[] = [
  {
    operationId: "getHealth",
    method: "get",
    path: "/api/v1/health",
    tags: ["System"],
    summary: "Process status, application version, and schema version.",
    responses: withError({ "200": jsonResponse("Health.", "HealthResponse") }),
  },
  {
    operationId: "getCapabilities",
    method: "get",
    path: "/api/v1/capabilities",
    tags: ["System"],
    summary: "Import and export formats, resource limits, fonts, and engine versions.",
    responses: withError({
      "200": jsonResponse("Capabilities.", "CapabilitiesResponse"),
    }),
  },
  {
    operationId: "listProjects",
    method: "get",
    path: "/api/v1/projects",
    tags: ["Projects"],
    summary: "List project summaries.",
    parameters: [...listQuery, includeDeletedQuery],
    responses: withError({ "200": jsonResponse("Project page.", "ProjectPage") }),
  },
  {
    operationId: "createProject",
    method: "post",
    path: "/api/v1/projects",
    tags: ["Projects"],
    summary: "Create a project at revision 0.",
    requestBody: jsonBody("ProjectWriteRequest"),
    idempotency: true,
    responses: withError({
      "201": jsonResponse("Created project.", "CreateProjectResponse"),
    }),
  },
  {
    operationId: "getProject",
    method: "get",
    path: "/api/v1/projects/{projectId}",
    tags: ["Projects"],
    summary: "Read project metadata.",
    parameters: [projectId],
    responses: withError({ "200": jsonResponse("Project.", "Project") }),
  },
  {
    operationId: "updateProject",
    method: "patch",
    path: "/api/v1/projects/{projectId}",
    tags: ["Projects"],
    summary: "Rename a project. Renames are not canvas history.",
    parameters: [projectId],
    requestBody: jsonBody("ProjectWriteRequest"),
    responses: withError({ "200": jsonResponse("Updated project.", "Project") }),
  },
  {
    operationId: "deleteProject",
    method: "delete",
    path: "/api/v1/projects/{projectId}",
    tags: ["Projects"],
    summary: "Soft-delete a project.",
    parameters: [projectId],
    responses: withError({ "200": jsonResponse("Soft-deleted project.", "Project") }),
  },
  {
    operationId: "restoreProject",
    method: "post",
    path: "/api/v1/projects/{projectId}/restore",
    tags: ["Projects"],
    summary: "Restore a soft-deleted project.",
    parameters: [projectId],
    idempotency: true,
    responses: withError({ "200": jsonResponse("Restored project.", "Project") }),
  },
  {
    operationId: "getDocument",
    method: "get",
    path: "/api/v1/projects/{projectId}/document",
    tags: ["Projects"],
    summary: "Current document, revision, hash, and history flags.",
    parameters: [projectId],
    responses: withError({ "200": jsonResponse("Document state.", "DocumentState") }),
  },
  {
    operationId: "listRevisions",
    method: "get",
    path: "/api/v1/projects/{projectId}/revisions",
    tags: ["Projects"],
    summary: "List immutable revision summaries.",
    parameters: [projectId, ...listQuery],
    responses: withError({ "200": jsonResponse("Revision page.", "RevisionPage") }),
  },
  {
    operationId: "getRevision",
    method: "get",
    path: "/api/v1/projects/{projectId}/revisions/{revision}",
    tags: ["Projects"],
    summary: "Read one immutable document snapshot.",
    parameters: [projectId, revision],
    responses: withError({ "200": jsonResponse("Revision snapshot.", "RevisionSnapshot") }),
  },
  {
    operationId: "commitTransaction",
    method: "post",
    path: "/api/v1/projects/{projectId}/transactions",
    tags: ["Projects"],
    summary: "Apply domain commands or accept a candidate.",
    parameters: [projectId],
    requestBody: jsonBody("TransactionRequest"),
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Transaction result.", "TransactionResponse"),
    }),
  },
  {
    operationId: "undo",
    method: "post",
    path: "/api/v1/projects/{projectId}/history/undo",
    tags: ["Projects"],
    summary: "Undo by creating a new revision.",
    parameters: [projectId],
    requestBody: jsonBody("HistoryRequest"),
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Transaction result.", "TransactionResponse"),
    }),
  },
  {
    operationId: "redo",
    method: "post",
    path: "/api/v1/projects/{projectId}/history/redo",
    tags: ["Projects"],
    summary: "Redo by creating a new revision.",
    parameters: [projectId],
    requestBody: jsonBody("HistoryRequest"),
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Transaction result.", "TransactionResponse"),
    }),
  },
  {
    operationId: "uploadAsset",
    method: "post",
    path: "/api/v1/projects/{projectId}/assets",
    tags: ["Assets"],
    summary: "Upload one file. Idempotency includes the file bytes.",
    parameters: [projectId],
    requestBody: fileUpload,
    idempotency: true,
    responses: withError({ "202": jsonResponse("Import accepted.", "AssetAccepted") }),
  },
  {
    operationId: "listAssets",
    method: "get",
    path: "/api/v1/projects/{projectId}/assets",
    tags: ["Assets"],
    summary: "List processing, ready, and failed asset records.",
    parameters: [projectId, ...listQuery],
    responses: withError({ "200": jsonResponse("Asset page.", "AssetPage") }),
  },
  {
    operationId: "getAsset",
    method: "get",
    path: "/api/v1/projects/{projectId}/assets/{assetId}",
    tags: ["Assets"],
    summary: "Read one asset record. Internal file paths are not included.",
    parameters: [projectId, assetId],
    responses: withError({ "200": jsonResponse("Asset.", "Asset") }),
  },
  {
    operationId: "getAssetContent",
    method: "get",
    path: "/api/v1/projects/{projectId}/assets/{assetId}/content",
    tags: ["Assets"],
    summary: "Download normalized content.",
    parameters: [projectId, assetId],
    responses: withError({
      "200": {
        description: "Normalized PNG or SVG.",
        content: binaryContent(["image/png", "image/svg+xml"]),
      },
    }),
  },
  {
    operationId: "getAssetOriginal",
    method: "get",
    path: "/api/v1/projects/{projectId}/assets/{assetId}/original",
    tags: ["Assets"],
    summary: "Download the original bytes.",
    parameters: [projectId, assetId],
    responses: withError({
      "200": {
        description: "Original PNG, JPEG, WebP, or SVG.",
        content: binaryContent([
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/svg+xml",
        ]),
      },
    }),
  },
  {
    operationId: "getAssetThumbnail",
    method: "get",
    path: "/api/v1/projects/{projectId}/assets/{assetId}/thumbnail",
    tags: ["Assets"],
    summary: "Download the thumbnail.",
    parameters: [projectId, assetId],
    responses: withError({
      "200": {
        description: "PNG thumbnail.",
        content: binaryContent(["image/png"]),
      },
    }),
  },
  {
    operationId: "removeAsset",
    method: "delete",
    path: "/api/v1/projects/{projectId}/assets/{assetId}",
    tags: ["Assets"],
    summary: "Soft-remove an asset that the current document does not reference.",
    parameters: [projectId, assetId],
    responses: withError({ "200": jsonResponse("Updated asset record.", "Asset") }),
  },
  {
    operationId: "createLayoutCandidates",
    method: "post",
    path: "/api/v1/projects/{projectId}/layout-candidates",
    tags: ["Layout"],
    summary: "Create at most three different layout candidates.",
    parameters: [projectId],
    requestBody: jsonBody("LayoutCandidatesRequest"),
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Candidates.", "LayoutCandidatesResponse"),
    }),
  },
  {
    operationId: "getCandidate",
    method: "get",
    path: "/api/v1/projects/{projectId}/candidates/{candidateId}",
    tags: ["Layout"],
    summary: "Read one candidate.",
    parameters: [projectId, candidateId],
    responses: withError({ "200": jsonResponse("Candidate.", "Candidate") }),
  },
  {
    operationId: "createAiLayout",
    method: "post",
    path: "/api/v1/projects/{projectId}/ai-layouts",
    tags: ["AI"],
    summary: "Queue a natural-language layout job.",
    parameters: [projectId],
    requestBody: jsonBody("AILayoutRequest"),
    idempotency: true,
    responses: withError({ "202": jsonResponse("Job accepted.", "JobAccepted") }),
  },
  {
    operationId: "createPreview",
    method: "post",
    path: "/api/v1/projects/{projectId}/previews",
    tags: ["Artifacts"],
    summary: "Queue a preview render.",
    parameters: [projectId],
    requestBody: jsonBody("PreviewRequest"),
    idempotency: true,
    responses: withError({ "202": jsonResponse("Job accepted.", "JobAccepted") }),
  },
  {
    operationId: "createExport",
    method: "post",
    path: "/api/v1/projects/{projectId}/exports",
    tags: ["Artifacts"],
    summary: "Queue an export bound to an explicit revision.",
    parameters: [projectId],
    requestBody: jsonBody("ExportRequest"),
    idempotency: true,
    responses: withError({ "202": jsonResponse("Job accepted.", "JobAccepted") }),
  },
  {
    operationId: "importProject",
    method: "post",
    path: "/api/v1/project-imports",
    tags: ["Projects"],
    summary: "Import a project package into a new project.",
    requestBody: fileUpload,
    idempotency: true,
    responses: withError({ "202": jsonResponse("Job accepted.", "JobAccepted") }),
  },
  {
    operationId: "downloadArtifact",
    method: "get",
    path: "/api/v1/artifacts/{artifactId}/download",
    tags: ["Artifacts"],
    summary: "Download a finished artifact.",
    parameters: [artifactId],
    responses: withError({
      "200": {
        description: "Artifact bytes. Content-Type is the stored media type.",
        content: binaryContent([
          "image/svg+xml",
          "image/png",
          "application/zip",
          "application/octet-stream",
        ]),
      },
    }),
  },
  {
    operationId: "getAiProviderSettings",
    method: "get",
    path: "/api/v1/settings/ai-provider",
    tags: ["Settings"],
    summary: "Read non-secret provider settings.",
    responses: withError({
      "200": jsonResponse("Provider settings.", "AIProviderSettings"),
    }),
  },
  {
    operationId: "putAiProviderSettings",
    method: "put",
    path: "/api/v1/settings/ai-provider",
    tags: ["Settings"],
    summary: "Replace non-secret provider settings.",
    requestBody: jsonBody("AIProviderConfig"),
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Provider settings.", "AIProviderSettings"),
    }),
  },
  {
    operationId: "putAiProviderSecret",
    method: "put",
    path: "/api/v1/settings/ai-provider/secret",
    tags: ["Settings"],
    summary: "Store the provider secret. The secret is not echoed.",
    requestBody: jsonBody("SecretWriteRequest"),
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Secret stored.", "SecretWriteResponse"),
    }),
  },
  {
    operationId: "deleteAiProviderSecret",
    method: "delete",
    path: "/api/v1/settings/ai-provider/secret",
    tags: ["Settings"],
    summary: "Delete the provider secret.",
    idempotency: true,
    responses: withError({
      "200": jsonResponse("Secret deleted.", "SecretDeleteResponse"),
    }),
  },
  {
    operationId: "testAiProvider",
    method: "post",
    path: "/api/v1/settings/ai-provider/test",
    tags: ["Settings"],
    summary: "Queue a provider test.",
    idempotency: true,
    responses: withError({ "202": jsonResponse("Job accepted.", "JobAccepted") }),
  },
  {
    operationId: "listFonts",
    method: "get",
    path: "/api/v1/fonts",
    tags: ["Fonts"],
    summary: "List bundled and registered fonts.",
    responses: withError({ "200": jsonResponse("Fonts.", "FontListResponse") }),
  },
  {
    operationId: "downloadFontBundle",
    method: "get",
    path: "/api/v1/fonts/bundle",
    tags: ["Fonts"],
    summary: "Download bundled fonts and their licenses.",
    responses: withError({
      "200": {
        description: "Zip of bundled font files and license texts.",
        content: binaryContent(["application/zip"]),
      },
    }),
  },
  {
    operationId: "getJob",
    method: "get",
    path: "/api/v1/jobs/{jobId}",
    tags: ["Jobs"],
    summary: "Read a job.",
    parameters: [jobId],
    responses: withError({ "200": jsonResponse("Job.", "Job") }),
  },
  {
    operationId: "streamJobEvents",
    method: "get",
    path: "/api/v1/jobs/{jobId}/events",
    tags: ["Jobs"],
    summary: "Stream job events. Supports Last-Event-ID and after. Heartbeat is 15 seconds.",
    parameters: [
      jobId,
      {
        name: "after",
        in: "query",
        required: false,
        schema: toJsonSchema(Type.Integer({ minimum: 0 })),
      },
      {
        name: "Last-Event-ID",
        in: "header",
        required: false,
        schema: toJsonSchema(Type.Integer({ minimum: 0 })),
      },
    ],
    responses: withError({
      "200": {
        description:
          "text/event-stream. Events: job.queued, job.started, job.progress, job.completed, job.failed, job.cancelled.",
        content: { "text/event-stream": { schema: { type: "string" } } },
      },
    }),
  },
  {
    operationId: "cancelJob",
    method: "post",
    path: "/api/v1/jobs/{jobId}/cancel",
    tags: ["Jobs"],
    summary: "Request cancellation. Disconnecting the event stream does not cancel the job.",
    parameters: [jobId],
    idempotency: true,
    responses: withError({ "202": jsonResponse("Cancellation requested.", "Job") }),
  },
];

export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const parameters = [...(operation.parameters ?? [])];
    if (operation.idempotency) parameters.unshift(idempotencyHeader);
    const pathItem = paths[operation.path] ?? {};
    pathItem[operation.method] = {
      operationId: operation.operationId,
      tags: operation.tags,
      summary: operation.summary,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(operation.requestBody ? { requestBody: operation.requestBody } : {}),
      responses: operation.responses,
    };
    paths[operation.path] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "PanelStudio API",
      version: APP_VERSION,
      license: { name: "MIT" },
      description:
        "HTTP contract for PanelStudio v0.1. Normative handbook: docs/PanelStudio-spec-v0.1.md. Phase 0 published this contract. Phase 1 implements asset import, panel and label commands, document revisions, SVG and project-package export, and project import. Phase 2 implements the edit kernel: frames, crops, labels, groups, locks, stack order, the remaining document commands, undo, redo, and restart restore. Phase 3 implements automatic layout candidates, candidate reads, preview renders, and accepting a candidate through the transaction path. Phase 5 implements provider settings, the provider test, AI layout jobs, job cancellation, and job event replay. Font download and the project list, delete, and restore routes remain in this contract. The response model does not contain provider secrets. All paths are under /api/v1. The service listens on loopback and is deployed same-origin. Authentication, when required, is an external reverse proxy.",
    },
    servers: [
      {
        url: "/",
        description: "Same-origin deployment.",
      },
    ],
    paths,
    components: {
      schemas: Object.fromEntries(
        Object.entries(componentSchemas).map(([name, schema]) => [name, toJsonSchema(schema)]),
      ),
    },
  };
}

export function renderOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
