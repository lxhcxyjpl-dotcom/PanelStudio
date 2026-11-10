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
import {
  abortProjectJobs,
  cancelAiJob,
  deleteProviderSecret,
  enqueueAiLayout,
  enqueueProviderTest,
  jobEvents,
  jobIsOpen,
  providerSettings,
  saveProviderConfig,
  saveProviderSecret,
  SSE_HEARTBEAT_INTERVAL_MS,
} from "./ai-jobs.js";
import { listJobEvents } from "./db.js";
import { fontBundle, fontList } from "./fonts.js";
import { ApiException, requireIdempotencyKey, sendError } from "./http.js";
import {
  commitHistory,
  commitTransaction,
  createLayoutCandidates,
  createPreview,
  createProject,
  deleteProject,
  exportFigure,
  importAsset,
  importProjectPackage,
  listProjects,
  listRevisions,
  readArtifact,
  readAsset,
  readAssetBytes,
  readAssets,
  readCandidate,
  readDocument,
  readJob,
  readProject,
  readRevision,
  removeUnusedAsset,
  renameProjectTitle,
  restoreProject,
  type AppContext,
  type ListPage,
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

  app.get("/api/v1/fonts", async () => fontList());

  app.get("/api/v1/fonts/bundle", async (_request, reply) => sendBytes(reply, fontBundle()));

  app.get("/api/v1/projects", async (request) => {
    return listProjects(ctx, { ...pageQuery(request.query), includeDeleted: includeDeletedOf(request.query) });
  });

  app.post("/api/v1/projects", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = createProject(ctx, titleOf(request.body), key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/projects/:projectId", async (request) => {
    return readProject(ctx, projectIdOf(request.params));
  });

  app.patch("/api/v1/projects/:projectId", async (request) => {
    return renameProjectTitle(ctx, projectIdOf(request.params), titleOf(request.body));
  });

  app.delete("/api/v1/projects/:projectId", async (request) => {
    const projectId = projectIdOf(request.params);
    const project = deleteProject(ctx, projectId);
    abortProjectJobs(ctx, projectId);
    return project;
  });

  app.post("/api/v1/projects/:projectId/restore", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = restoreProject(ctx, projectIdOf(request.params), key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.delete("/api/v1/projects/:projectId/assets/:assetId", async (request) => {
    const params = assetParams(request.params);
    return removeUnusedAsset(ctx, params.projectId, params.assetId);
  });

  app.get("/api/v1/projects/:projectId/document", async (request) => {
    return readDocument(ctx, projectIdOf(request.params));
  });

  app.get("/api/v1/projects/:projectId/revisions", async (request) => {
    return listRevisions(ctx, projectIdOf(request.params), pageQuery(request.query));
  });

  app.get("/api/v1/projects/:projectId/revisions/:revision", async (request) => {
    return readRevision(ctx, projectIdOf(request.params), idOf(request.params, "revision"));
  });

  app.get("/api/v1/projects/:projectId/assets", async (request) => {
    return readAssets(ctx, projectIdOf(request.params), pageQuery(request.query));
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

  app.post("/api/v1/projects/:projectId/history/undo", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = commitHistory(ctx, projectIdOf(request.params), "undo", request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/projects/:projectId/history/redo", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = commitHistory(ctx, projectIdOf(request.params), "redo", request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/projects/:projectId/layout-candidates", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = createLayoutCandidates(
      ctx,
      projectIdOf(request.params),
      request.body,
      key,
      hashJson(request.body),
    );
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/projects/:projectId/candidates/:candidateId", async (request) => {
    return readCandidate(ctx, projectIdOf(request.params), idOf(request.params, "candidateId"));
  });

  app.post("/api/v1/projects/:projectId/previews", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = createPreview(ctx, projectIdOf(request.params), request.body, key, hashJson(request.body));
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

  app.get("/api/v1/jobs/:jobId/events", async (request, reply) => {
    const jobId = idOf(request.params, "jobId");
    jobEvents(ctx, jobId, -1);
    const after = eventCursor(request.headers["last-event-id"], request.query);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let cursor = after;
    let lastWrite = Date.now();
    const pump = (): boolean => {
      const events = listJobEvents(ctx.db, jobId, cursor);
      for (const event of events) {
        raw.write(`id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.payloadJson)}\n\n`);
        cursor = event.seq;
        lastWrite = Date.now();
      }
      if (!jobIsOpen(ctx, jobId) && listJobEvents(ctx.db, jobId, cursor).length === 0) {
        raw.end();
        return true;
      }
      if (Date.now() - lastWrite >= SSE_HEARTBEAT_INTERVAL_MS) {
        raw.write(": heartbeat\n\n");
        lastWrite = Date.now();
      }
      return false;
    };
    if (!pump()) {
      const timer = setInterval(() => {
        if (pump()) clearInterval(timer);
      }, 250);
      raw.on("close", () => clearInterval(timer));
    }
  });

  app.post("/api/v1/jobs/:jobId/cancel", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = cancelAiJob(ctx, idOf(request.params, "jobId"), key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/settings/ai-provider", async () => providerSettings(ctx));

  app.put("/api/v1/settings/ai-provider", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = saveProviderConfig(ctx, request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.put("/api/v1/settings/ai-provider/secret", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = saveProviderSecret(ctx, request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.delete("/api/v1/settings/ai-provider/secret", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = deleteProviderSecret(ctx, key, hashJson(request.body ?? null));
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/settings/ai-provider/test", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = enqueueProviderTest(ctx, key, hashJson(request.body ?? null));
    return reply.status(result.status).send(result.body);
  });

  app.post("/api/v1/projects/:projectId/ai-layouts", async (request, reply) => {
    const key = requireIdempotencyKey(request);
    const result = enqueueAiLayout(ctx, projectIdOf(request.params), request.body, key, hashJson(request.body));
    return reply.status(result.status).send(result.body);
  });

  app.get("/api/v1/artifacts/:artifactId/download", async (request, reply) => {
    return sendBytes(reply, readArtifact(ctx, idOf(request.params, "artifactId")));
  });
}

function pageQuery(query: unknown): ListPage {
  const record = queryRecord(query);
  let cursor: string | null = null;
  if ("cursor" in record && record.cursor !== undefined) {
    const value = oneQuery(record.cursor);
    if (typeof value !== "string" || value.length === 0) {
      throw new ApiException("REQUEST_INVALID", "The cursor is invalid.");
    }
    cursor = value;
  }
  let limit: number | null = null;
  if ("limit" in record && record.limit !== undefined) {
    const value = oneQuery(record.limit);
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new ApiException("REQUEST_INVALID", "The page limit must be an integer from 1 to 100.");
    }
    limit = parsed;
  }
  return { cursor, limit };
}

function includeDeletedOf(query: unknown): boolean {
  const record = queryRecord(query);
  if (!("includeDeleted" in record) || record.includeDeleted === undefined) return false;
  const value = oneQuery(record.includeDeleted);
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ApiException("REQUEST_INVALID", "includeDeleted must be true or false.");
}

function queryRecord(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== "object" || Array.isArray(query)) return {};
  return query as Record<string, unknown>;
}

function oneQuery(value: unknown): unknown {
  if (Array.isArray(value)) throw new ApiException("REQUEST_INVALID", "The query parameter is invalid.");
  return value;
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

function eventCursor(header: string | string[] | undefined, query: unknown): number {
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const fromQuery = query && typeof query === "object" && "after" in query ? (query as { after?: unknown }).after : undefined;
  const raw = fromHeader ?? fromQuery;
  const value = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : -1;
  return Number.isInteger(value) && value >= 0 ? value : -1;
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
