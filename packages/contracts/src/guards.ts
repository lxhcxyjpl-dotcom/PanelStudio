import { Check } from "typebox/value";
import { ExportRequestSchema, HistoryRequestSchema, type ExportRequest } from "./api.js";
import type { HistoryRequest } from "./api.js";
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
