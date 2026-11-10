import { createHash } from "node:crypto";
import {
  APP_VERSION,
  PHASE0_CAPABILITY_SAMPLE,
  RESOURCE_LIMITS,
  SCHEMA_VERSION,
} from "@panelstudio/contracts";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { canonicalJson } from "@panelstudio/core";
import { ApiException, requireIdempotencyKey, sendError } from "./http.js";
import {
  commitTransaction,
  createProject,
  exportFigure,
  importAsset,
  importProjectPackage,
  readArtifact,
  readAsset,
  readAssetBytes,
  readAssets,
  readDocument,
  readJob,
  readProject,
  type AppContext,
} from "./pipeline.js";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  void app.register(multipart, {
    limits: {
      files: 1,
      fileSize: RESOURCE_LIMITS.maxProjectPackageUncompressedBytes,
    },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiException) {
      sendError(reply, request, error);
      return;
    }
    const candidate = error as { statusCode?: number; validation?: unknown };
    const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
    if (candidate.validation) {
      sendError(reply, request, new ApiException("REQUEST_INVALID", "The request is invalid."));
      return;
    }
    if (statusCode === 413) {
      sendError(reply, request, new ApiException("FILE_TOO_LARGE", "The file exceeds the size limit."));
      return;
    }
    sendError(
      reply,
      request,
      new ApiException("REQUEST_INVALID", "Unexpected server error.", {}, 500),
    );
  });

  app.setNotFoundHandler((request, reply) => {
    sendError(reply, request, new ApiException("NOT_FOUND", "The route was not found."));
  });

  app.get("/api/v1/health", async () => ({
    status: "ok" as const,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
  }));

  app.get("/api/v1/capabilities", async () => PHASE0_CAPABILITY_SAMPLE);

  app.post("/api/v1/projects", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = createProject(ctx, titleOf(request.body), key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/projects/:projectId", async (request) => {
    return readProject(ctx, projectIdOf(request.params));
  });

  app.get("/api/v1/projects/:projectId/document", async (request) => {
    return readDocument(ctx, projectIdOf(request.params));
  });

  app.get("/api/v1/projects/:projectId/assets", async (request) => {
    return readAssets(ctx, projectIdOf(request.params));
  });

  app.get("/api/v1/projects/:projectId/assets/:assetId", async (request) => {
    const params = assetParams(request.params);
    return readAsset(ctx, params.projectId, params.assetId);
  });

  app.get("/api/v1/projects/:projectId/assets/:assetId/original", async (request, reply) => {
    const params = assetParams(request.params);
    return sendBytes(reply, readAssetBytes(ctx, params.projectId, params.assetId, "original"));
  });

  app.get("/api/v1/projects/:projectId/assets/:assetId/content", async (request, reply) => {
    const params = assetParams(request.params);
    return sendBytes(reply, readAssetBytes(ctx, params.projectId, params.assetId, "content"));
  });

  app.get("/api/v1/projects/:projectId/assets/:assetId/thumbnail", async (request, reply) => {
    const params = assetParams(request.params);
    return sendBytes(reply, readAssetBytes(ctx, params.projectId, params.assetId, "thumbnail"));
  });

  app.post("/api/v1/projects/:projectId/assets", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const uploaded = await readUpload(request);
    const result = await importAsset(
      ctx,
      projectIdOf(request.params),
      uploaded.filename,
      uploaded.bytes,
      key,
      hashUpload(uploaded.filename, uploaded.bytes),
    );
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/projects/:projectId/transactions", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = commitTransaction(ctx, projectIdOf(request.params), request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/projects/:projectId/exports", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = await exportFigure(ctx, projectIdOf(request.params), request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/project-imports", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const uploaded = await readUpload(request);
    const result = await importProjectPackage(ctx, uploaded.bytes, key, hashUpload(uploaded.filename, uploaded.bytes));
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/jobs/:jobId", async (request) => readJob(ctx, idOf(request.params, "jobId")));

  app.get("/api/v1/artifacts/:artifactId/download", async (request, reply) => {
    return sendBytes(reply, readArtifact(ctx, idOf(request.params, "artifactId")));
  });
}

function titleOf(body: unknown): unknown {
  if (!body || typeof body !== "object" || !("title" in body)) return undefined;
  return body.title;
}

function projectIdOf(params: unknown): string {
  return idOf(params, "projectId");
}

function idOf(params: unknown, name: string): string {
  if (!params || typeof params !== "object" || !(name in params)) {
    throw new ApiException("REQUEST_INVALID", "The request path is invalid.");
  }
  const value = (params as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiException("REQUEST_INVALID", "The request path is invalid.");
  }
  return value;
}

function assetParams(params: unknown): { projectId: string; assetId: string } {
  return { projectId: projectIdOf(params), assetId: idOf(params, "assetId") };
}

function hashJson(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body ?? null)).digest("hex");
}

function hashUpload(filename: string, bytes: Buffer): string {
  return createHash("sha256").update(filename).update("\0").update(bytes).digest("hex");
}

async function readUpload(request: { file: () => Promise<{ filename: string; fieldname: string; toBuffer: () => Promise<Buffer> } | undefined> }): Promise<{ filename: string; bytes: Buffer }> {
  const file = await request.file();
  if (!file || file.fieldname !== "file") {
    throw new ApiException("REQUEST_INVALID", "The file part must be named file.");
  }
  return { filename: file.filename || "upload", bytes: await file.toBuffer() };
}

function sendBytes(
  reply: { header: (name: string, value: string) => unknown; send: (payload: Buffer) => unknown },
  file: { bytes: Buffer; mediaType: string; filename: string },
) {
  const filename = file.filename.replace(/["\r\n]/gu, "");
  reply.header("content-type", file.mediaType);
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  return reply.send(file.bytes);
}
