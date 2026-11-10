import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  APP_VERSION,
  ENGINE_VERSIONS,
  NORMALIZATION_VERSION,
  RESOURCE_LIMITS,
  isExportRequest,
  isHistoryRequest,
  isLayoutCandidatesRequest,
  isPreviewRequest,
  isTransactionRequest,
  createDefaultFigureDocument,
  pngPixelsFromMm,
  type Candidate,
  type Diagnostic,
  type DomainCommand,
  type ErrorCode,
  type ExportRequest,
  type FigureDocumentV1,
  type Job,
  type LayoutCandidatesRequest,
  type NormalizedAsset,
  type PreviewRequest,
  type TransactionRequest,
} from "@panelstudio/contracts";
import { solveLayout } from "@panelstudio/layout";
import {
  DocumentCommandError,
  applyCommands,
  assertFigureDocument,
  canonicalJson,
  contentPlacement,
  hashFigureDocument,
  resolvePanelLabel,
  sha256,
  type ReadyAssetFacts,
} from "@panelstudio/core";
import { compileFigureSvg, normalizeSvg, SvgImportError, type ExportPanel } from "@panelstudio/svg";
import type { BlobStore } from "./blobs.js";
import {
  countAssets,
  getArtifact,
  getAsset,
  getCandidate,
  getIdempotency,
  getJob,
  getProject,
  getRevision,
  immediate,
  insertArtifact,
  insertAsset,
  insertCandidate,
  insertIdempotency,
  insertJob,
  insertJobEvent,
  insertProject,
  insertRevision,
  listAssets,
  markAssetRemoved,
  publicAsset,
  publicJob,
  renameProject,
  sumOriginalBytes,
  touchProject,
  updateProjectHead,
  type AssetRecord,
  type JobRecord,
  type ProjectRecord,
} from "./db.js";
import { buildProjectPackage, readProjectPackage, type PackagedAsset } from "./figure-package.js";
import { ApiException } from "./http.js";
import { normalizeRaster, rasterizeSvg, sniffMediaType, type RasterMediaType } from "./raster.js";
import type Database from "better-sqlite3";

export type AppContext = {
  db: Database.Database;
  blobs: BlobStore;
  now: () => string;
};

type Response = { status: number; body: unknown };

export function createProject(ctx: AppContext, title: unknown, key: string, requestHash: string): Response {
  if (!isTitle(title)) throw new ApiException("REQUEST_INVALID", "The project title is invalid.");
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, "project-create", key, requestHash);
    if (replay) return replay;
    const now = ctx.now();
    const id = randomUUID();
    const document = createDefaultFigureDocument();
    const project: ProjectRecord = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      currentRevision: 0,
      undoStack: [],
      redoStack: [],
    };
    insertProject(ctx.db, project, {
      document,
      documentHash: hashFigureDocument(document),
      kind: "create",
      engineVersion: ENGINE_VERSIONS.svg,
      createdAt: now,
    });
    const body = {
      project: {
        id,
        title,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        currentRevision: 0,
      },
      revision: 0 as const,
    };
    remember(ctx, "project-create", key, requestHash, 201, body);
    return { status: 201, body };
  });
}

export function readProject(ctx: AppContext, projectId: string) {
  return projectView(requireProject(ctx, projectId));
}

/**
 * Handbook project rename. It updates the project row only.
 * The document, revision, and undo stacks stay where they are.
 */
export function renameProjectTitle(ctx: AppContext, projectId: string, title: unknown) {
  if (!isTitle(title)) throw new ApiException("REQUEST_INVALID", "The project title is invalid.");
  return immediate(ctx.db, () => {
    const project = requireProject(ctx, projectId);
    assertMutable(project);
    if (project.title !== title) renameProject(ctx.db, projectId, title, ctx.now());
    const next = requireProject(ctx, projectId);
    return projectView(next);
  });
}

/**
 * Soft-remove a library asset the current document does not reference.
 * Bytes stay so older revisions can still open the original.
 */
export function removeUnusedAsset(ctx: AppContext, projectId: string, assetId: string) {
  return immediate(ctx.db, () => {
    const project = requireProject(ctx, projectId);
    assertMutable(project);
    const asset = requireAsset(ctx, projectId, assetId);
    const document = requireRevision(ctx, projectId, project.currentRevision).document;
    const used = Object.values(document.panels).some((panel) => panel.assetId === assetId);
    if (used) {
      throw new ApiException("ASSET_IN_USE", "The asset is used by the current document.", {
        assetIds: [assetId],
      });
    }
    if (!asset.removedFromLibraryAt) markAssetRemoved(ctx.db, assetId, ctx.now());
    return publicAsset(requireAsset(ctx, projectId, assetId));
  });
}

export function readDocument(ctx: AppContext, projectId: string) {
  const project = requireProject(ctx, projectId);
  const revision = requireRevision(ctx, projectId, project.currentRevision);
  return {
    projectId,
    revision: revision.revision,
    document: revision.document,
    documentHash: revision.documentHash,
    history: historyOf(project),
  };
}

export function readAssets(ctx: AppContext, projectId: string) {
  requireProject(ctx, projectId);
  return { items: listAssets(ctx.db, projectId).map(publicAsset), nextCursor: null };
}

export function readAsset(ctx: AppContext, projectId: string, assetId: string) {
  return publicAsset(requireAsset(ctx, projectId, assetId));
}

export function readAssetBytes(
  ctx: AppContext,
  projectId: string,
  assetId: string,
  kind: "original" | "content" | "thumbnail",
): { bytes: Buffer; mediaType: string; filename: string } {
  const asset = requireAsset(ctx, projectId, assetId);
  if (kind === "original") {
    return {
      bytes: ctx.blobs.read(asset.originalBlobPath),
      mediaType: asset.originalMediaType,
      filename: asset.originalFilename,
    };
  }
  if (asset.status !== "ready" || !asset.renderBlobPath || !asset.thumbnailBlobPath || !asset.normalized) {
    throw new ApiException("NOT_FOUND", "The asset has no normalized content.");
  }
  if (kind === "thumbnail") {
    return {
      bytes: ctx.blobs.read(asset.thumbnailBlobPath),
      mediaType: "image/png",
      filename: `${asset.id}-thumbnail.png`,
    };
  }
  const extension = asset.normalized.renderMediaType === "image/svg+xml" ? ".svg" : ".png";
  return {
    bytes: ctx.blobs.read(asset.renderBlobPath),
    mediaType: asset.normalized.renderMediaType,
    filename: `${asset.id}${extension}`,
  };
}

export async function importAsset(
  ctx: AppContext,
  projectId: string,
  filename: string,
  bytes: Buffer,
  key: string,
  requestHash: string,
): Promise<Response> {
  const project = requireProject(ctx, projectId);
  assertMutable(project);
  const replay = takeReplay(ctx, `asset:${projectId}`, key, requestHash);
  if (replay) return replay;
  if (bytes.byteLength > RESOURCE_LIMITS.maxUploadBytes) {
    throw new ApiException("FILE_TOO_LARGE", "The file exceeds the 25 MiB upload limit.");
  }
  if (countAssets(ctx.db, projectId) >= RESOURCE_LIMITS.maxAssetsPerProject) {
    throw new ApiException("REQUEST_INVALID", "The project asset library is full.");
  }
  if (sumOriginalBytes(ctx.db, projectId) + bytes.byteLength > RESOURCE_LIMITS.maxOriginalAssetBytesPerProject) {
    throw new ApiException("FILE_TOO_LARGE", "The project exceeds the original asset byte limit.");
  }
  const mediaType = sniffMediaType(bytes);
  if (!mediaType) {
    throw new ApiException("UNSUPPORTED_MEDIA_TYPE", "The file is not a PNG, JPEG, WebP, or SVG.");
  }
  const assetId = randomUUID();
  const jobId = randomUUID();
  const now = ctx.now();
  const original = ctx.blobs.put(bytes);
  const safeName = path.basename(filename).replace(/[\r\n"]/gu, "") || "upload";
  let record: AssetRecord;
  let error: Job["error"] = null;
  try {
    record = await readyAsset({
      ctx,
      projectId,
      assetId,
      jobId,
      now,
      filename: safeName,
      mediaType,
      bytes,
      originalPath: original.relativePath,
      originalSha: original.sha256,
    });
  } catch (caught) {
    const failed = failureOf(caught);
    error = { code: failed.code, message: failed.message };
    record = {
      id: assetId,
      projectId,
      createdAt: now,
      originalFilename: safeName,
      originalMediaType: mediaType,
      originalByteLength: bytes.byteLength,
      originalSha256: original.sha256,
      status: "failed",
      importJobId: jobId,
      normalized: null,
      diagnostics: failed.diagnostics,
      removedFromLibraryAt: null,
      originalBlobPath: original.relativePath,
      renderBlobPath: null,
      thumbnailBlobPath: null,
    };
  }
  const body = { assetId, jobId };
  return immediate(ctx.db, () => {
    const again = takeReplay(ctx, `asset:${projectId}`, key, requestHash);
    if (again) return again;
    insertAsset(ctx.db, record);
    writeJob(ctx, {
      id: jobId,
      projectId,
      kind: "asset_import",
      status: error ? "failed" : "succeeded",
      phase: error ? "failed" : "ready",
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      result: error ? null : { assetId },
      error,
      inputJson: { originalFilename: safeName, originalSha256: original.sha256 },
    });
    touchProject(ctx.db, projectId, now);
    remember(ctx, `asset:${projectId}`, key, requestHash, 202, body);
    return { status: 202, body };
  });
}

export function commitTransaction(
  ctx: AppContext,
  projectId: string,
  body: unknown,
  key: string,
  requestHash: string,
): Response {
  if (!isTransactionRequest(body)) {
    throw new ApiException("REQUEST_INVALID", "The transaction request is invalid.");
  }
  const request = body as TransactionRequest;
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, `transaction:${projectId}`, key, requestHash);
    if (replay) return replay;
    const project = requireProject(ctx, projectId);
    assertMutable(project);
    if ("candidateId" in request) {
      return acceptCandidate(ctx, project, request.baseRevision, request.candidateId, key, requestHash);
    }
    if (project.currentRevision !== request.baseRevision) {
      throw new ApiException("REVISION_CONFLICT", "The document has changed.", {
        expectedRevision: request.baseRevision,
        actualRevision: project.currentRevision,
      });
    }
    const current = requireRevision(ctx, projectId, project.currentRevision);
    let next: FigureDocumentV1;
    try {
      next = applyCommands(current.document, request.commands as DomainCommand[], (assetId) =>
        readyFacts(ctx, projectId, assetId),
      );
    } catch (error) {
      if (error instanceof DocumentCommandError) {
        throw new ApiException(error.code, error.message, error.details);
      }
      throw error;
    }
    const saved = saveRevision(ctx, project, current.document, next, {
      baseRevision: request.baseRevision,
      kind: "transaction",
      commandsJson: request.commands,
      targetRevision: null,
      undoStack: [...project.undoStack, project.currentRevision],
      redoStack: [],
    });
    const response = transactionBody(projectId, saved);
    remember(ctx, `transaction:${projectId}`, key, requestHash, 200, response);
    return { status: 200, body: response };
  });
}

function acceptCandidate(
  ctx: AppContext,
  project: ProjectRecord,
  baseRevision: number,
  candidateId: string,
  key: string,
  requestHash: string,
): Response {
  const candidate = getCandidate(ctx.db, candidateId);
  if (!candidate || candidate.projectId !== project.id) {
    throw new ApiException("NOT_FOUND", "Candidate was not found.");
  }
  if (project.currentRevision !== baseRevision) {
    throw new ApiException("REVISION_CONFLICT", "The document has changed.", {
      expectedRevision: baseRevision,
      actualRevision: project.currentRevision,
    });
  }
  if (
    candidate.baseRevision !== project.currentRevision ||
    candidate.engineVersion !== ENGINE_VERSIONS.layout ||
    candidate.fontRegistryVersion !== ENGINE_VERSIONS.fontRegistry
  ) {
    throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.", {
      expectedRevision: candidate.baseRevision,
      actualRevision: project.currentRevision,
    });
  }
  const current = requireRevision(ctx, project.id, project.currentRevision);
  let next: FigureDocumentV1;
  try {
    next = applyCommands(current.document, candidate.commands, (assetId) => readyFacts(ctx, project.id, assetId));
  } catch (error) {
    if (error instanceof DocumentCommandError) {
      throw new ApiException(error.code, error.message, error.details);
    }
    throw error;
  }
  if (hashFigureDocument(next) !== candidate.resultDocumentHash) {
    throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.", {
      expectedRevision: candidate.baseRevision,
      actualRevision: project.currentRevision,
    });
  }
  const saved = saveRevision(ctx, project, current.document, next, {
    baseRevision,
    kind: "transaction",
    commandsJson: candidate.commands,
    targetRevision: null,
    undoStack: [...project.undoStack, project.currentRevision],
    redoStack: [],
  });
  const response = transactionBody(project.id, saved, candidate.diagnostics);
  remember(ctx, `transaction:${project.id}`, key, requestHash, 200, response);
  return { status: 200, body: response };
}

export function createLayoutCandidates(
  ctx: AppContext,
  projectId: string,
  body: unknown,
  key: string,
  requestHash: string,
): Response {
  if (!isLayoutCandidatesRequest(body)) {
    throw new ApiException("REQUEST_INVALID", "The layout request is invalid.");
  }
  const request = body as LayoutCandidatesRequest;
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, `layout:${projectId}`, key, requestHash);
    if (replay) return replay;
    const project = requireProject(ctx, projectId);
    assertMutable(project);
    if (project.currentRevision !== request.baseRevision) {
      throw new ApiException("REVISION_CONFLICT", "The document has changed.", {
        expectedRevision: request.baseRevision,
        actualRevision: project.currentRevision,
      });
    }
    const current = requireRevision(ctx, projectId, project.currentRevision);
    const solved = solveLayout({
      document: current.document,
      request: request.request,
      assets: assetFactsForDocument(ctx, projectId, current.document),
      ...(request.maxCandidates ? { maxCandidates: request.maxCandidates } : {}),
    });
    if (!solved.ok) {
      throw new ApiException(solved.code, solved.message, solved.details);
    }
    const now = ctx.now();
    const candidates = solved.candidates.map((candidate) => {
      const id = deterministicUuid({
        projectId,
        baseRevision: request.baseRevision,
        engineVersion: ENGINE_VERSIONS.layout,
        fontRegistryVersion: ENGINE_VERSIONS.fontRegistry,
        summary: candidate.summary,
        commands: candidate.commands,
        score: candidate.score,
      });
      const record = {
        id,
        projectId,
        baseRevision: request.baseRevision,
        origin: "layout" as const,
        validationMode: "layout" as const,
        commands: candidate.commands,
        resultDocumentHash: hashFigureDocument(candidate.previewDocument),
        summary: candidate.summary,
        diagnostics: candidate.diagnostics,
        score: candidate.score,
        engineVersion: ENGINE_VERSIONS.layout,
        fontRegistryVersion: ENGINE_VERSIONS.fontRegistry,
        createdAt: now,
      };
      insertCandidate(ctx.db, record);
      return publicCandidate(record, candidate.previewDocument);
    });
    const response = { candidates };
    remember(ctx, `layout:${projectId}`, key, requestHash, 200, response);
    return { status: 200, body: response };
  });
}

export function readCandidate(ctx: AppContext, projectId: string, candidateId: string): Candidate {
  requireProject(ctx, projectId);
  const candidate = getCandidate(ctx.db, candidateId);
  if (!candidate || candidate.projectId !== projectId) {
    throw new ApiException("NOT_FOUND", "Candidate was not found.");
  }
  const revision = getRevision(ctx.db, projectId, candidate.baseRevision);
  if (!revision) throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.");
  let preview: FigureDocumentV1;
  try {
    preview = applyCommands(revision.document, candidate.commands, (assetId) => readyFacts(ctx, projectId, assetId));
  } catch (error) {
    if (error instanceof DocumentCommandError) {
      throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.", error.details);
    }
    throw error;
  }
  if (hashFigureDocument(preview) !== candidate.resultDocumentHash) {
    throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.");
  }
  return publicCandidate(candidate, preview);
}

export function createPreview(
  ctx: AppContext,
  projectId: string,
  body: unknown,
  key: string,
  requestHash: string,
): Response {
  if (!isPreviewRequest(body)) throw new ApiException("REQUEST_INVALID", "The preview request is invalid.");
  const request = body as PreviewRequest;
  const replay = takeReplay(ctx, `preview:${projectId}`, key, requestHash);
  if (replay) return replay;
  const project = requireProject(ctx, projectId);
  assertMutable(project);
  const source = previewSource(ctx, projectId, request);
  const pixelHeight = Math.max(1, Math.round((request.pixelWidth * source.document.canvas.heightMm) / source.document.canvas.widthMm));
  if (
    request.pixelWidth > RESOURCE_LIMITS.maxPngOutputEdgePx ||
    pixelHeight > RESOURCE_LIMITS.maxPngOutputEdgePx ||
    request.pixelWidth * pixelHeight > RESOURCE_LIMITS.maxPngOutputPixels
  ) {
    throw new ApiException("EXPORT_TOO_LARGE", "The preview exceeds the output limit.");
  }
  const jobId = randomUUID();
  const now = ctx.now();
  try {
    const compiled = compileDocument(ctx, projectId, source.document, source.revision, false);
    const png = rasterizeSvg(compiled.svg, request.pixelWidth);
    const stored = ctx.blobs.put(png);
    const artifactId = randomUUID();
    return immediate(ctx.db, () => {
      const again = takeReplay(ctx, `preview:${projectId}`, key, requestHash);
      if (again) return again;
      insertArtifact(ctx.db, {
        id: artifactId,
        projectId,
        revision: source.revision,
        candidateId: source.candidateId,
        kind: "preview",
        mediaType: "image/png",
        filename: "preview.png",
        byteLength: png.byteLength,
        sha256: stored.sha256,
        blobPath: stored.relativePath,
        rendererVersion: "resvg-js@2.6.2",
        createdAt: now,
      });
      writeJob(ctx, {
        id: jobId,
        projectId,
        kind: "preview",
        status: "succeeded",
        phase: "ready",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        result: { artifactId },
        error: null,
        inputJson: request,
      });
      const response = { jobId };
      remember(ctx, `preview:${projectId}`, key, requestHash, 202, response);
      return { status: 202, body: response };
    });
  } catch (error) {
    const failed = failureOf(error);
    return immediate(ctx.db, () => {
      const again = takeReplay(ctx, `preview:${projectId}`, key, requestHash);
      if (again) return again;
      writeJob(ctx, {
        id: jobId,
        projectId,
        kind: "preview",
        status: "failed",
        phase: "failed",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        result: null,
        error: { code: failed.code, message: failed.message },
        inputJson: request,
      });
      const response = { jobId };
      remember(ctx, `preview:${projectId}`, key, requestHash, 202, response);
      return { status: 202, body: response };
    });
  }
}

function previewSource(
  ctx: AppContext,
  projectId: string,
  request: PreviewRequest,
): { document: FigureDocumentV1; revision: number; candidateId: string | null } {
  if ("candidateId" in request.source) {
    const candidate = getCandidate(ctx.db, request.source.candidateId);
    if (!candidate || candidate.projectId !== projectId) {
      throw new ApiException("NOT_FOUND", "Candidate was not found.");
    }
    const revision = getRevision(ctx.db, projectId, candidate.baseRevision);
    if (!revision) throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.");
    let document: FigureDocumentV1;
    try {
      document = applyCommands(revision.document, candidate.commands, (assetId) => readyFacts(ctx, projectId, assetId));
    } catch (error) {
      if (error instanceof DocumentCommandError) {
        throw new ApiException("CANDIDATE_STALE", "The candidate does not match this document.", error.details);
      }
      throw error;
    }
    return { document, revision: candidate.baseRevision, candidateId: candidate.id };
  }
  const revision = getRevision(ctx.db, projectId, request.source.revision);
  if (!revision) throw new ApiException("NOT_FOUND", "That revision was not found.");
  return { document: revision.document, revision: revision.revision, candidateId: null };
}

function assetFactsForDocument(
  ctx: AppContext,
  projectId: string,
  document: FigureDocumentV1,
): Record<string, { viewport: { width: number; height: number }; rasterPixelSize: { width: number; height: number } | null }> {
  const assets: Record<string, { viewport: { width: number; height: number }; rasterPixelSize: { width: number; height: number } | null }> = {};
  for (const panel of Object.values(document.panels)) {
    if (assets[panel.assetId]) continue;
    const facts = readyFacts(ctx, projectId, panel.assetId);
    if (!facts) continue;
    assets[panel.assetId] = { viewport: facts.viewport, rasterPixelSize: facts.rasterPixelSize };
  }
  return assets;
}

function publicCandidate(
  candidate: {
    id: string;
    projectId: string;
    baseRevision: number;
    origin: "layout" | "ai";
    validationMode: "edit" | "layout";
    commands: DomainCommand[];
    resultDocumentHash: string;
    summary: string;
    diagnostics: Diagnostic[];
    engineVersion: string;
    fontRegistryVersion: string;
  },
  previewDocument: FigureDocumentV1,
): Candidate {
  return {
    id: candidate.id,
    projectId: candidate.projectId,
    baseRevision: candidate.baseRevision,
    origin: candidate.origin,
    validationMode: candidate.validationMode,
    summary: candidate.summary,
    commands: candidate.commands,
    previewDocument,
    resultDocumentHash: candidate.resultDocumentHash,
    diagnostics: candidate.diagnostics,
    engineVersion: candidate.engineVersion,
    fontRegistryVersion: candidate.fontRegistryVersion,
  };
}

function deterministicUuid(material: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(material)).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function commitHistory(
  ctx: AppContext,
  projectId: string,
  direction: "undo" | "redo",
  body: unknown,
  key: string,
  requestHash: string,
): Response {
  if (!isHistoryRequest(body)) {
    throw new ApiException("REQUEST_INVALID", "The history request is invalid.");
  }
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, `history:${projectId}`, key, requestHash);
    if (replay) return replay;
    const project = requireProject(ctx, projectId);
    assertMutable(project);
    if (project.currentRevision !== body.baseRevision) {
      throw new ApiException("REVISION_CONFLICT", "The document has changed.", {
        expectedRevision: body.baseRevision,
        actualRevision: project.currentRevision,
      });
    }
    const source = direction === "undo" ? project.undoStack : project.redoStack;
    if (source.length === 0) {
      throw new ApiException(
        "REQUEST_INVALID",
        direction === "undo" ? "There is nothing to undo." : "There is nothing to redo.",
      );
    }
    const targetRevision = source[source.length - 1];
    if (targetRevision === undefined) {
      throw new ApiException(
        "REQUEST_INVALID",
        direction === "undo" ? "There is nothing to undo." : "There is nothing to redo.",
      );
    }
    const target = requireRevision(ctx, projectId, targetRevision);
    const current = requireRevision(ctx, projectId, project.currentRevision);
    const nextSource = source.slice(0, -1);
    const saved = saveRevision(ctx, project, current.document, target.document, {
      baseRevision: body.baseRevision,
      kind: direction,
      commandsJson: [],
      targetRevision,
      undoStack: direction === "undo" ? nextSource : [...project.undoStack, project.currentRevision],
      redoStack: direction === "redo" ? nextSource : [...project.redoStack, project.currentRevision],
    });
    const response = transactionBody(projectId, saved);
    remember(ctx, `history:${projectId}`, key, requestHash, 200, response);
    return { status: 200, body: response };
  });
}

export async function exportFigure(
  ctx: AppContext,
  projectId: string,
  body: unknown,
  key: string,
  requestHash: string,
): Promise<Response> {
  if (!isExportRequest(body)) {
    throw new ApiException("REQUEST_INVALID", "The export request is invalid.");
  }
  const request = body as ExportRequest;
  const replay = takeReplay(ctx, `export:${projectId}`, key, requestHash);
  if (replay) return replay;
  const project = requireProject(ctx, projectId);
  assertMutable(project);
  const revision = getRevision(ctx.db, projectId, request.revision);
  if (!revision) throw new ApiException("NOT_FOUND", "That revision was not found.");
  if (request.format === "png") {
    const width = pngPixelsFromMm(revision.document.canvas.widthMm, request.options.dpi);
    const height = pngPixelsFromMm(revision.document.canvas.heightMm, request.options.dpi);
    if (
      width > RESOURCE_LIMITS.maxPngOutputEdgePx ||
      height > RESOURCE_LIMITS.maxPngOutputEdgePx ||
      width * height > RESOURCE_LIMITS.maxPngOutputPixels
    ) {
      throw new ApiException("EXPORT_TOO_LARGE", "The PNG export exceeds the output limit.");
    }
  }
  const jobId = randomUUID();
  const now = ctx.now();
  try {
    const produced = await produceExport(ctx, project, revision.document, revision.revision, request);
    const stored = ctx.blobs.put(produced.bytes);
    const artifactId = randomUUID();
    const result = {
      artifactId,
      revision: revision.revision,
      format: request.format,
      diagnostics: produced.diagnostics,
    };
    return immediate(ctx.db, () => {
      const again = takeReplay(ctx, `export:${projectId}`, key, requestHash);
      if (again) return again;
      insertArtifact(ctx.db, {
        id: artifactId,
        projectId,
        revision: revision.revision,
        candidateId: null,
        kind: request.format,
        mediaType: produced.mediaType,
        filename: produced.filename,
        byteLength: produced.bytes.byteLength,
        sha256: stored.sha256,
        blobPath: stored.relativePath,
        rendererVersion: produced.rendererVersion,
        createdAt: now,
      });
      writeJob(ctx, {
        id: jobId,
        projectId,
        kind: "export",
        status: "succeeded",
        phase: "ready",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        result,
        error: null,
        inputJson: request,
      });
      const response = { jobId };
      remember(ctx, `export:${projectId}`, key, requestHash, 202, response);
      return { status: 202, body: response };
    });
  } catch (error) {
    const failed = failureOf(error);
    return immediate(ctx.db, () => {
      const again = takeReplay(ctx, `export:${projectId}`, key, requestHash);
      if (again) return again;
      writeJob(ctx, {
        id: jobId,
        projectId,
        kind: "export",
        status: "failed",
        phase: "failed",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        result: null,
        error: { code: failed.code, message: failed.message },
        inputJson: request,
      });
      const response = { jobId };
      remember(ctx, `export:${projectId}`, key, requestHash, 202, response);
      return { status: 202, body: response };
    });
  }
}

export async function importProjectPackage(
  ctx: AppContext,
  bytes: Buffer,
  key: string,
  requestHash: string,
): Promise<Response> {
  const replay = takeReplay(ctx, "project-import", key, requestHash);
  if (replay) return replay;
  if (bytes.byteLength > RESOURCE_LIMITS.maxProjectPackageUncompressedBytes) {
    throw new ApiException("FILE_TOO_LARGE", "The project package exceeds the size limit.");
  }
  const jobId = randomUUID();
  const now = ctx.now();
  try {
    const unpacked = readProjectPackage(bytes);
    if (unpacked.manifest.title.trim().length === 0 || unpacked.manifest.title.length > 120) {
      throw new ApiException("DOCUMENT_INVALID", "The packaged title is invalid.");
    }
    const projectId = randomUUID();
    const idMap = new Map(unpacked.assets.map((asset) => [asset.id, randomUUID()]));
    const document = structuredClone(unpacked.document);
    for (const panel of Object.values(document.panels)) {
      const mapped = idMap.get(panel.assetId);
      if (!mapped) throw new ApiException("DOCUMENT_INVALID", "The document references a missing asset.");
      panel.assetId = mapped;
    }
    assertFigureDocument(document, (assetId) => factsForImport(unpacked.assets, idMap, assetId));
    const stored = unpacked.assets.map((asset) => ({
      asset,
      id: idMap.get(asset.id) ?? "",
      original: ctx.blobs.put(asset.original),
      render: ctx.blobs.put(asset.render),
      thumbnail: ctx.blobs.put(asset.thumbnail),
    }));
    const documentHash = hashFigureDocument(document);
    return immediate(ctx.db, () => {
      const again = takeReplay(ctx, "project-import", key, requestHash);
      if (again) return again;
      insertProject(
        ctx.db,
        {
          id: projectId,
          title: unpacked.manifest.title,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          currentRevision: 0,
          undoStack: [],
          redoStack: [],
        },
        {
          document,
          documentHash,
          kind: "import",
          engineVersion: ENGINE_VERSIONS.svg,
          createdAt: now,
        },
      );
      for (const item of stored) {
        insertAsset(ctx.db, {
          id: item.id,
          projectId,
          createdAt: now,
          originalFilename: item.asset.originalFilename,
          originalMediaType: item.asset.originalMediaType as AssetRecord["originalMediaType"],
          originalByteLength: item.asset.original.byteLength,
          originalSha256: item.original.sha256,
          status: "ready",
          importJobId: jobId,
          normalized: item.asset.normalized,
          diagnostics: item.asset.diagnostics,
          removedFromLibraryAt: null,
          originalBlobPath: item.original.relativePath,
          renderBlobPath: item.render.relativePath,
          thumbnailBlobPath: item.thumbnail.relativePath,
        });
      }
      writeJob(ctx, {
        id: jobId,
        projectId,
        kind: "project_import",
        status: "succeeded",
        phase: "ready",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        result: { projectId, revision: 0 },
        error: null,
        inputJson: { sha256: sha256(bytes) },
      });
      const response = { jobId };
      remember(ctx, "project-import", key, requestHash, 202, response);
      return { status: 202, body: response };
    });
  } catch (error) {
    if (error instanceof ApiException && (error.code === "FILE_TOO_LARGE" || error.code === "REQUEST_INVALID")) {
      throw error;
    }
    const failed = failureOf(error);
    return immediate(ctx.db, () => {
      const again = takeReplay(ctx, "project-import", key, requestHash);
      if (again) return again;
      writeJob(ctx, {
        id: jobId,
        projectId: null,
        kind: "project_import",
        status: "failed",
        phase: "failed",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        result: null,
        error: { code: failed.code, message: failed.message },
        inputJson: { sha256: sha256(bytes) },
      });
      const response = { jobId };
      remember(ctx, "project-import", key, requestHash, 202, response);
      return { status: 202, body: response };
    });
  }
}

export function readJob(ctx: AppContext, jobId: string): Job {
  const job = getJob(ctx.db, jobId);
  if (!job) throw new ApiException("NOT_FOUND", "The job was not found.");
  return publicJob(job);
}

export function readArtifact(ctx: AppContext, artifactId: string): {
  bytes: Buffer;
  mediaType: string;
  filename: string;
} {
  const artifact = getArtifact(ctx.db, artifactId);
  if (!artifact) throw new ApiException("NOT_FOUND", "The artifact was not found.");
  return {
    bytes: ctx.blobs.read(artifact.blobPath),
    mediaType: artifact.mediaType,
    filename: artifact.filename,
  };
}

async function readyAsset(input: {
  ctx: AppContext;
  projectId: string;
  assetId: string;
  jobId: string;
  now: string;
  filename: string;
  mediaType: RasterMediaType | "image/svg+xml";
  bytes: Buffer;
  originalPath: string;
  originalSha: string;
}): Promise<AssetRecord> {
  let normalized: NormalizedAsset;
  let diagnostics: Diagnostic[];
  let renderPath: string;
  let thumbnailPath: string;
  if (input.mediaType === "image/svg+xml") {
    const svg = normalizeSvg(input.bytes.toString("utf8"));
    const render = Buffer.from(svg.svg);
    const stored = input.ctx.blobs.put(render);
    const thumbnail = input.ctx.blobs.put(rasterizeSvg(svg.svg, 256));
    renderPath = stored.relativePath;
    thumbnailPath = thumbnail.relativePath;
    normalized = {
      renderMediaType: "image/svg+xml",
      renderSha256: stored.sha256,
      normalizationVersion: NORMALIZATION_VERSION,
      viewport: svg.viewport,
      rasterPixelSize: null,
      fonts: svg.fonts,
      normalizationNotes: svg.notes,
    };
    diagnostics = svg.diagnostics;
  } else {
    const raster = await normalizeRaster(input.bytes, input.mediaType);
    const stored = input.ctx.blobs.put(raster.renderBytes);
    const thumbnail = input.ctx.blobs.put(raster.thumbnail);
    renderPath = stored.relativePath;
    thumbnailPath = thumbnail.relativePath;
    normalized = {
      renderMediaType: "image/png",
      renderSha256: stored.sha256,
      normalizationVersion: NORMALIZATION_VERSION,
      viewport: raster.viewport,
      rasterPixelSize: raster.rasterPixelSize,
      fonts: [],
      normalizationNotes: raster.notes,
    };
    diagnostics = [];
  }
  return {
    id: input.assetId,
    projectId: input.projectId,
    createdAt: input.now,
    originalFilename: input.filename,
    originalMediaType: input.mediaType,
    originalByteLength: input.bytes.byteLength,
    originalSha256: input.originalSha,
    status: "ready",
    importJobId: input.jobId,
    normalized,
    diagnostics,
    removedFromLibraryAt: null,
    originalBlobPath: input.originalPath,
    renderBlobPath: renderPath,
    thumbnailBlobPath: thumbnailPath,
  };
}

async function produceExport(
  ctx: AppContext,
  project: ProjectRecord,
  document: FigureDocumentV1,
  revision: number,
  request: ExportRequest,
): Promise<{ bytes: Buffer; mediaType: string; filename: string; rendererVersion: string; diagnostics: Diagnostic[] }> {
  const stem = fileStem(project.title);
  if (request.format === "svg" || request.format === "png") {
    const compiled = compileDocument(ctx, project.id, document, revision, request.format === "svg" ? request.options.includeMetadata : false);
    if (request.format === "svg") {
      return {
        bytes: Buffer.from(compiled.svg),
        mediaType: "image/svg+xml",
        filename: `${stem}.svg`,
        rendererVersion: ENGINE_VERSIONS.svg,
        diagnostics: compiled.diagnostics,
      };
    }
    const width = pngPixelsFromMm(document.canvas.widthMm, request.options.dpi);
    const png = rasterizeSvg(compiled.svg, width);
    return {
      bytes: png,
      mediaType: "image/png",
      filename: `${stem}.png`,
      rendererVersion: "resvg-js@2.6.2",
      diagnostics: compiled.diagnostics,
    };
  }
  const assets = packageAssets(ctx, project.id);
  const compiled = compileDocument(ctx, project.id, document, revision, false);
  let preview: Buffer | null = null;
  const diagnostics = [...compiled.diagnostics];
  if (request.options.includeBundledFonts) {
    diagnostics.push({
      code: "FONT_MISSING",
      severity: "warning",
      messageKey: "font.filesNotVendored",
      params: { family: "Noto Sans" },
    });
  }
  try {
    const previewWidth = Math.min(1200, pngPixelsFromMm(document.canvas.widthMm, 150));
    preview = rasterizeSvg(compiled.svg, previewWidth);
  } catch {
    diagnostics.push({
      code: "PREVIEW_UNAVAILABLE",
      severity: "warning",
      messageKey: "export.previewUnavailable",
      params: {},
    });
  }
  const families = fontDependencies(document, assets);
  const packed = buildProjectPackage({
    title: project.title,
    appVersion: APP_VERSION,
    document,
    assets,
    preview,
    fontDependencies: { families },
  });
  return {
    bytes: packed,
    mediaType: "application/zip",
    filename: `${stem}.figurezip`,
    rendererVersion: ENGINE_VERSIONS.svg,
    diagnostics,
  };
}

function compileDocument(
  ctx: AppContext,
  projectId: string,
  document: FigureDocumentV1,
  revision: number,
  includeMetadata: boolean,
): { svg: string; diagnostics: Diagnostic[] } {
  const panels: ExportPanel[] = document.stackOrder.map((panelId) => {
    const panel = document.panels[panelId];
    if (!panel) throw new ApiException("DOCUMENT_INVALID", "The document is missing a panel.");
    const asset = requireAsset(ctx, projectId, panel.assetId);
    if (asset.status !== "ready" || !asset.normalized || !asset.renderBlobPath) {
      throw new ApiException("DOCUMENT_INVALID", "A panel references an asset that is not ready.", {
        assetIds: [panel.assetId],
        panelIds: [panelId],
      });
    }
    const place = contentPlacement(panel.frameMm, panel.cropNormalized, asset.normalized.viewport);
    const resolved = resolvePanelLabel(document, panelId);
    const label = resolved
      ? {
          text: resolved.text,
          x: resolved.x,
          y: resolved.y,
          fontFamily: resolved.fontFamily,
          fontSizeUser: resolved.fontSizeUser,
          fontWeight: resolved.fontWeight,
          color: resolved.color,
        }
      : null;
    if (asset.normalized.renderMediaType === "image/svg+xml") {
      return {
        kind: "vector" as const,
        panelId,
        frame: panel.frameMm,
        label,
        normalizedSvg: ctx.blobs.read(asset.renderBlobPath).toString("utf8"),
        x: place.x,
        y: place.y,
        scale: place.scale,
      };
    }
    return {
      kind: "raster" as const,
      panelId,
      frame: panel.frameMm,
      label,
      png: ctx.blobs.read(asset.renderBlobPath),
      x: place.x,
      y: place.y,
      width: place.width,
      height: place.height,
    };
  });
  const compiled = compileFigureSvg({
    widthMm: document.canvas.widthMm,
    heightMm: document.canvas.heightMm,
    revision,
    includeMetadata,
    panels,
  });
  return {
    svg: compiled.svg,
    diagnostics: compiled.fontFamilies.map((family) => ({
      code: "FONT_MISSING",
      severity: "warning" as const,
      messageKey: "font.notInstalled",
      params: { family },
    })),
  };
}

function packageAssets(ctx: AppContext, projectId: string): PackagedAsset[] {
  const assets: PackagedAsset[] = [];
  for (const asset of listAssets(ctx.db, projectId)) {
    if (asset.status !== "ready" || !asset.normalized || !asset.renderBlobPath || !asset.thumbnailBlobPath) continue;
    assets.push({
      id: asset.id,
      originalFilename: asset.originalFilename,
      originalMediaType: asset.originalMediaType,
      diagnostics: asset.diagnostics,
      normalized: asset.normalized,
      original: ctx.blobs.read(asset.originalBlobPath),
      render: ctx.blobs.read(asset.renderBlobPath),
      thumbnail: ctx.blobs.read(asset.thumbnailBlobPath),
    });
  }
  return assets;
}

function fontDependencies(document: FigureDocumentV1, assets: PackagedAsset[]) {
  const families: Array<{ family: string; role: string; assetId?: string }> = [];
  if (document.labelStyle.visible) {
    families.push({ family: document.labelStyle.fontId === "noto-sans-sc" ? "Noto Sans SC" : "Noto Sans", role: "label" });
  }
  for (const asset of assets) {
    for (const font of asset.normalized.fonts) {
      families.push({ family: font.family, role: "asset", assetId: asset.id });
    }
  }
  return families;
}

function factsForImport(
  assets: PackagedAsset[],
  idMap: Map<string, string>,
  assetId: string,
): ReadyAssetFacts | null {
  for (const asset of assets) {
    if (idMap.get(asset.id) !== assetId) continue;
    return {
      id: assetId,
      originalFilename: asset.originalFilename,
      viewport: asset.normalized.viewport,
      rasterPixelSize: asset.normalized.rasterPixelSize,
    };
  }
  return null;
}

function readyFacts(ctx: AppContext, projectId: string, assetId: string): ReadyAssetFacts | null {
  const asset = getAsset(ctx.db, assetId);
  if (!asset || asset.projectId !== projectId || asset.status !== "ready" || !asset.normalized) return null;
  return {
    id: asset.id,
    originalFilename: asset.originalFilename,
    viewport: asset.normalized.viewport,
    rasterPixelSize: asset.normalized.rasterPixelSize,
  };
}

function requireProject(ctx: AppContext, projectId: string): ProjectRecord {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new ApiException("NOT_FOUND", "The project was not found.");
  return project;
}

function requireRevision(ctx: AppContext, projectId: string, revision: number) {
  const record = getRevision(ctx.db, projectId, revision);
  if (!record) throw new ApiException("NOT_FOUND", "That revision was not found.");
  return record;
}

function requireAsset(ctx: AppContext, projectId: string, assetId: string): AssetRecord {
  const asset = getAsset(ctx.db, assetId);
  if (!asset || asset.projectId !== projectId) throw new ApiException("NOT_FOUND", "The asset was not found.");
  return asset;
}

function assertMutable(project: ProjectRecord): void {
  if (project.deletedAt) throw new ApiException("PROJECT_DELETED", "The project is deleted.");
}

function saveRevision(
  ctx: AppContext,
  project: ProjectRecord,
  current: FigureDocumentV1,
  next: FigureDocumentV1,
  change: {
    baseRevision: number;
    kind: string;
    commandsJson: unknown;
    targetRevision: number | null;
    undoStack: number[];
    redoStack: number[];
  },
): {
  revision: number;
  changed: boolean;
  document: FigureDocumentV1;
  documentHash: string;
  history: { canUndo: boolean; canRedo: boolean };
} {
  const changed = canonicalJson(next) !== canonicalJson(current);
  let revision = project.currentRevision;
  let undoStack = project.undoStack;
  let redoStack = project.redoStack;
  const document = changed ? next : current;
  if (changed) {
    revision += 1;
    undoStack = change.undoStack;
    redoStack = change.redoStack;
    const now = ctx.now();
    insertRevision(ctx.db, {
      projectId: project.id,
      revision,
      baseRevision: change.baseRevision,
      kind: change.kind,
      document,
      documentHash: hashFigureDocument(document),
      commandsJson: change.commandsJson,
      transactionId: randomUUID(),
      targetRevision: change.targetRevision,
      engineVersion: ENGINE_VERSIONS.svg,
      createdAt: now,
    });
    updateProjectHead(ctx.db, {
      id: project.id,
      currentRevision: revision,
      updatedAt: now,
      undoStack,
      redoStack,
    });
  }
  return {
    revision,
    changed,
    document,
    documentHash: hashFigureDocument(document),
    history: { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 },
  };
}

function transactionBody(
  projectId: string,
  saved: {
    revision: number;
    changed: boolean;
    document: FigureDocumentV1;
    documentHash: string;
    history: { canUndo: boolean; canRedo: boolean };
  },
  diagnostics: Diagnostic[] = [],
) {
  return {
    projectId,
    revision: saved.revision,
    changed: saved.changed,
    document: saved.document,
    documentHash: saved.documentHash,
    diagnostics,
    history: saved.history,
  };
}

function historyOf(project: ProjectRecord) {
  return { canUndo: project.undoStack.length > 0, canRedo: project.redoStack.length > 0 };
}

function projectView(project: ProjectRecord) {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
    currentRevision: project.currentRevision,
  };
}

function takeReplay(ctx: AppContext, scope: string, key: string, requestHash: string): Response | null {
  const existing = getIdempotency(ctx.db, scope, key);
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new ApiException("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused for a different request.");
  }
  return { status: existing.httpStatus, body: JSON.parse(existing.responseJson) as unknown };
}

function remember(
  ctx: AppContext,
  scope: string,
  key: string,
  requestHash: string,
  status: number,
  body: unknown,
): void {
  insertIdempotency(ctx.db, {
    scope,
    key,
    requestHash,
    httpStatus: status,
    responseJson: JSON.stringify(body),
    createdAt: ctx.now(),
  });
}

function writeJob(
  ctx: AppContext,
  job: JobRecord & { inputJson: unknown },
): void {
  insertJob(ctx.db, job);
  const phases: Array<{ event: string; status: Job["status"]; phase: string }> = [
    { event: "job.queued", status: "queued", phase: "queued" },
    { event: "job.started", status: "running", phase: job.kind },
    {
      event: job.status === "failed" ? "job.failed" : "job.completed",
      status: job.status,
      phase: job.phase,
    },
  ];
  phases.forEach((item, seq) => {
    insertJobEvent(ctx.db, {
      jobId: job.id,
      seq,
      event: item.event,
      payloadJson: { status: item.status, phase: item.phase, progress: null },
      createdAt: job.createdAt,
    });
  });
}

function failureOf(error: unknown): { code: ErrorCode; message: string; diagnostics: Diagnostic[] } {
  if (error instanceof SvgImportError) {
    return { code: error.code, message: error.message, diagnostics: error.diagnostics };
  }
  if (error instanceof DocumentCommandError) {
    return {
      code: error.code,
      message: error.message,
      diagnostics: [
        {
          code: error.code,
          severity: "error",
          messageKey: "document.invalid",
          params: { feature: error.message },
        },
      ],
    };
  }
  if (error instanceof ApiException) {
    return {
      code: error.code,
      message: error.message,
      diagnostics: [
        {
          code: error.code,
          severity: "error",
          messageKey: "import.failed",
          params: { feature: error.message },
        },
      ],
    };
  }
  return {
    code: "DOCUMENT_INVALID",
    message: "The request could not be completed.",
    diagnostics: [
      {
        code: "DOCUMENT_INVALID",
        severity: "error",
        messageKey: "document.invalid",
        params: { feature: "The request could not be completed." },
      },
    ],
  };
}

function isTitle(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 120;
}

function fileStem(title: string): string {
  const cleaned = title.replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return (cleaned.length > 0 ? cleaned : "figure").slice(0, 80);
}
