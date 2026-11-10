import { Check } from "typebox/value";
import {
  AIIntentSchema,
  AILayoutRequestSchema,
  AIProviderConfigSchema,
  SecretWriteRequestSchema,
  type AIIntent,
  type AILayoutRequest,
  type AIProviderConfig,
} from "./ai.js";
import {
  ExportRequestSchema,
  HistoryRequestSchema,
  LayoutCandidatesRequestSchema,
  PreviewRequestSchema,
  type ExportRequest,
  type HistoryRequest,
  type PreviewRequest,
} from "./api.js";
import type { Static } from "typebox";
import { TransactionRequestSchema, type TransactionRequest } from "./commands.js";
import { FigureDocumentSchema, type FigureDocumentV1 } from "./document.js";
import { ProjectManifestSchema, type ProjectManifest } from "./project-package.js";

export function isFigureDocument(value: unknown): value is FigureDocumentV1 {
  return Check(FigureDocumentSchema, value);
}

export function isTransactionRequest(value: unknown): value is TransactionRequest {
  return Check(TransactionRequestSchema, value);
}

export function isHistoryRequest(value: unknown): value is HistoryRequest {
  return Check(HistoryRequestSchema, value);
}

export function isExportRequest(value: unknown): value is ExportRequest {
  return Check(ExportRequestSchema, value);
}

export function isProjectManifest(value: unknown): value is ProjectManifest {
  return Check(ProjectManifestSchema, value);
}

export type LayoutCandidatesRequest = Static<typeof LayoutCandidatesRequestSchema>;

export function isLayoutCandidatesRequest(value: unknown): value is LayoutCandidatesRequest {
  return Check(LayoutCandidatesRequestSchema, value);
}

export function isPreviewRequest(value: unknown): value is PreviewRequest {
  return Check(PreviewRequestSchema, value);
}

export function isAIProviderConfig(value: unknown): value is AIProviderConfig {
  return Check(AIProviderConfigSchema, value);
}

export function isAILayoutRequest(value: unknown): value is AILayoutRequest {
  return Check(AILayoutRequestSchema, value);
}

export function isAIIntent(value: unknown): value is AIIntent {
  return Check(AIIntentSchema, value);
}

export function isSecretWriteRequest(value: unknown): value is Static<typeof SecretWriteRequestSchema> {
  return Check(SecretWriteRequestSchema, value);
}
