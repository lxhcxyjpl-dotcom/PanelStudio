import { createHash, randomUUID } from "node:crypto";
import {
  AIProviderSettingsSchema,
  CandidateSchema,
  ENGINE_VERSIONS,
  RESOURCE_LIMITS,
  SSE_HEARTBEAT_INTERVAL_MS,
  isAIIntent,
  isAILayoutRequest,
  isAIProviderConfig,
  isSecretWriteRequest,
  type AILayoutRequest,
  type AIProviderConfig,
  type AIProviderSettings,
  type Candidate,
  type ErrorCode,
  type FigureDocumentV1,
  type Job,
} from "@panelstudio/contracts";
import {
  AiCompileError,
  AiTransportError,
  buildScene,
  compileProposal,
  endpointProblem,
  isDirectUndo,
  postChatCompletion,
  resolveModelIntent,
  reviewModelIntent,
  transportMessage,
} from "@panelstudio/ai";
import { Check } from "typebox/value";
import {
  DocumentCommandError,
  applyCommands,
  canonicalJson,
  hashFigureDocument,
  type AssetLookup,
} from "@panelstudio/core";
import {
  appendJobEvent,
  getAsset,
  getJob,
  getJobDetail,
  getProject,
  getRevision,
  immediate,
  insertCandidate,
  insertIdempotency,
  insertJob,
  getIdempotency,
  listActiveAiJobs,
  listJobEvents,
  listQueuedAiJobs,
  markCancelRequested,
  publicJob,
  readProvider,
  updateJobState,
  writeProviderConfig,
  type JobDetail,
  type ProviderRecord,
} from "./db.js";
import { ApiException } from "./http.js";
import { renderDocumentPng, type AppContext } from "./pipeline.js";
import { decryptSecret, encryptSecret, masterKey } from "./secret.js";

const tails = new WeakMap<AppContext["db"], Promise<void>>();
const inflight = new Map<string, AbortController>();

type Response = { status: number; body: unknown };

export function providerSettings(ctx: AppContext): AIProviderSettings {
  return settingsOf(readProvider(ctx.db));
}

export function saveProviderConfig(ctx: AppContext, body: unknown, key: string, requestHash: string): Response {
  if (!isAIProviderConfig(body)) throw new ApiException("REQUEST_INVALID", "The provider settings are invalid.");
  const problem = settingsEndpointProblem(body);
  if (problem) throw new ApiException("REQUEST_INVALID", problem);
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, "settings:ai-provider", key, requestHash);
    if (replay) return replay;
    const current = readProvider(ctx.db);
    const saved = writeProviderConfig(ctx.db, body, current?.encryptedSecret ?? null, ctx.now());
    stopStaleAiJobs(ctx, saved.configRevision);
    const response = settingsOf(saved);
    if (!Check(AIProviderSettingsSchema, response)) {
      throw new ApiException("DOCUMENT_INVALID", "The provider settings could not be stored.");
    }
    remember(ctx, "settings:ai-provider", key, requestHash, 200, response);
    return { status: 200, body: response };
  });
}

export function saveProviderSecret(ctx: AppContext, body: unknown, key: string, requestHash: string): Response {
  if (!isSecretWriteRequest(body)) throw new ApiException("REQUEST_INVALID", "The secret is invalid.");
  if (/[\r\n]/u.test(body.secret)) throw new ApiException("REQUEST_INVALID", "The secret is invalid.");
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, "settings:ai-provider:secret", key, requestHash);
    if (replay) return replay;
    const current = readProvider(ctx.db);
    if (!current) throw new ApiException("REQUEST_INVALID", "Save the provider settings before the secret.");
    const saved = writeProviderConfig(ctx.db, current.config, encryptSecret(masterKey(ctx.dataDir), body.secret), ctx.now());
    stopStaleAiJobs(ctx, saved.configRevision);
    const response = { configRevision: saved.configRevision, hasSecret: true as const };
    remember(ctx, "settings:ai-provider:secret", key, requestHash, 200, response);
    return { status: 200, body: response };
  });
}

export function deleteProviderSecret(ctx: AppContext, key: string, requestHash: string): Response {
  return immediate(ctx.db, () => {
    const replay = takeReplay(ctx, "settings:ai-provider:secret:delete", key, requestHash);
    if (replay) return replay;
    const current = readProvider(ctx.db);
    if (!current || !current.encryptedSecret) {
      const response = { configRevision: current?.configRevision ?? 0, hasSecret: false as const };
      remember(ctx, "settings:ai-provider:secret:delete", key, requestHash, 200, response);
      return { status: 200, body: response };
    }
    const saved = writeProviderConfig(ctx.db, current.config, null, ctx.now());
    stopStaleAiJobs(ctx, saved.configRevision);
    const response = { configRevision: saved.configRevision, hasSecret: false as const };
    remember(ctx, "settings:ai-provider:secret:delete", key, requestHash, 200, response);
    return { status: 200, body: response };
  });
}

export function enqueueProviderTest(ctx: AppContext, key: string, requestHash: string): Response {
  const created = immediate(ctx.db, () => {
    const replay = takeReplay(ctx, "settings:ai-provider:test", key, requestHash);
    if (replay) return { replay };
    const provider = readProvider(ctx.db);
    const jobId = randomUUID();
    const now = ctx.now();
    insertJob(ctx.db, {
      id: jobId,
      projectId: null,
      kind: "provider_test",
      status: "queued",
      phase: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      inputJson: { configRevision: provider?.configRevision ?? 0 },
    });
    appendJobEvent(ctx.db, {
      jobId,
      event: "job.queued",
      payloadJson: { status: "queued", phase: "queued", progress: null },
      createdAt: now,
    });
    const response = { jobId };
    remember(ctx, "settings:ai-provider:test", key, requestHash, 202, response);
    return { response };
  });
  if ("replay" in created && created.replay) return created.replay;
  scheduleAiJobs(ctx);
  return { status: 202, body: created.response };
}

export function enqueueAiLayout(
  ctx: AppContext,
  projectId: string,
  body: unknown,
  key: string,
  requestHash: string,
): Response {
  if (!isAILayoutRequest(body)) throw new ApiException("REQUEST_INVALID", "The AI request is invalid.");
  const created = immediate(ctx.db, () => {
    const replay = takeReplay(ctx, `ai:${projectId}`, key, requestHash);
    if (replay) return { replay };
    const project = requireProject(ctx, projectId);
    if (project.deletedAt) throw new ApiException("PROJECT_DELETED", "The project is deleted.");
    if (project.currentRevision !== body.baseRevision) {
      throw new ApiException("REVISION_CONFLICT", "The document has changed.", {
        expectedRevision: body.baseRevision,
        actualRevision: project.currentRevision,
      });
    }
    const revision = getRevision(ctx.db, projectId, body.baseRevision);
    if (!revision) throw new ApiException("NOT_FOUND", "That revision was not found.");
    const missing = body.selectedPanelIds.filter((id) => !revision.document.panels[id]);
    if (missing.length > 0) {
      throw new ApiException("REQUEST_INVALID", "The selection names a panel that is not in this revision.", {
        panelIds: missing,
      });
    }
    const provider = readProvider(ctx.db);
    const jobId = randomUUID();
    const now = ctx.now();
    insertJob(ctx.db, {
      id: jobId,
      projectId,
      kind: "ai_layout",
      status: "queued",
      phase: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      inputJson: { request: body, configRevision: provider?.configRevision ?? 0 },
    });
    appendJobEvent(ctx.db, {
      jobId,
      event: "job.queued",
      payloadJson: { status: "queued", phase: "queued", progress: null },
      createdAt: now,
    });
    const response = { jobId };
    remember(ctx, `ai:${projectId}`, key, requestHash, 202, response);
    return { response };
  });
  if ("replay" in created && created.replay) return created.replay;
  scheduleAiJobs(ctx);
  return { status: 202, body: created.response };
}

export function cancelAiJob(ctx: AppContext, jobId: string, key: string, requestHash: string): Response {
  const response = immediate(ctx.db, () => {
    const replay = takeReplay(ctx, `job-cancel:${jobId}`, key, requestHash);
    if (replay) return replay;
    const job = getJobDetail(ctx.db, jobId);
    if (!job) throw new ApiException("NOT_FOUND", "The job was not found.");
    if (job.status === "queued") {
      markCancelRequested(ctx.db, jobId);
      finish(ctx, jobId, "cancelled", "cancelled", null, null);
    } else if (job.status === "running") {
      markCancelRequested(ctx.db, jobId);
    }
    const current = requireJob(ctx, jobId);
    remember(ctx, `job-cancel:${jobId}`, key, requestHash, 202, current);
    return { status: 202, body: current };
  });
  inflight.get(jobId)?.abort();
  return response;
}

export function jobEvents(ctx: AppContext, jobId: string, after: number) {
  if (!getJob(ctx.db, jobId)) throw new ApiException("NOT_FOUND", "The job was not found.");
  return listJobEvents(ctx.db, jobId, after);
}

export function jobIsOpen(ctx: AppContext, jobId: string): boolean {
  const job = getJob(ctx.db, jobId);
  return job?.status === "queued" || job?.status === "running";
}

export function scheduleAiJobs(ctx: AppContext): void {
  if (ctx.deferAiJobs) return;
  let tail = tails.get(ctx.db) ?? Promise.resolve();
  for (const job of listQueuedAiJobs(ctx.db)) {
    tail = tail.then(() => runAiJob(ctx, job.id)).catch(() => undefined);
  }
  tails.set(ctx.db, tail);
}

export async function drainAiJobs(ctx: AppContext): Promise<void> {
  for (const job of listQueuedAiJobs(ctx.db)) {
    await runAiJob(ctx, job.id);
  }
}

export function failInterruptedAiJobs(ctx: AppContext): void {
  for (const job of listActiveAiJobs(ctx.db)) {
    finish(ctx, job.id, "failed", "failed", null, {
      code: "SERVER_RESTARTED",
      message: "The server restarted before this AI request finished. It was not sent again.",
    });
  }
}

export { SSE_HEARTBEAT_INTERVAL_MS };

async function runAiJob(ctx: AppContext, jobId: string): Promise<void> {
  const claimed = claim(ctx, jobId);
  if (!claimed) return;
  const controller = new AbortController();
  inflight.set(jobId, controller);
  const timeout = AbortSignal.timeout(30_000);
  const signal = AbortSignal.any([controller.signal, timeout]);
  try {
    if (claimed.kind === "provider_test") await runProviderTest(ctx, claimed, signal);
    else await runLayout(ctx, claimed, signal);
  } catch (error) {
    const current = getJobDetail(ctx.db, jobId);
    if (!current || current.status !== "running") return;
    const provider = readProvider(ctx.db);
    if (!provider) {
      finish(ctx, jobId, "failed", "failed", null, { code: "PROVIDER_NOT_CONFIGURED", message: "AI is not configured." });
      return;
    }
    if (provider.configRevision !== configRevisionOf(current)) {
      finish(ctx, jobId, "failed", "failed", null, {
        code: "PROVIDER_CONFIG_CHANGED",
        message: "The provider settings changed before this request finished.",
      });
      return;
    }
    if (isTimeout(error)) {
      finish(ctx, jobId, "failed", "failed", null, { code: "REQUEST_INVALID", message: "The provider request timed out." });
      return;
    }
    if (current.cancelRequested || isAbort(error)) {
      finish(ctx, jobId, "cancelled", "cancelled", null, null);
      return;
    }
    const mapped = mapFailure(error);
    finish(ctx, jobId, "failed", "failed", null, mapped);
  } finally {
    inflight.delete(jobId);
  }
}

async function runProviderTest(ctx: AppContext, job: JobDetail, signal: AbortSignal): Promise<void> {
  const ready = openProvider(ctx, job);
  if (!ready) return;
  setPhase(ctx, job.id, "requesting");
  const started = Date.now();
  const content = await postChatCompletion({
    config: ready.config,
    secret: ready.secret,
    fetchImpl: ctx.aiFetch,
    signal,
    maxTokens: 64,
    messages: [{ role: "user", content: 'Reply with JSON {"ok":true} only.' }],
  });
  if (!stillCurrent(ctx, job.id, ready.provider.configRevision)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    finish(ctx, job.id, "failed", "failed", null, {
      code: "MODEL_OUTPUT_INVALID",
      message: "The provider test did not return JSON.",
    });
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    finish(ctx, job.id, "failed", "failed", null, {
      code: "MODEL_OUTPUT_INVALID",
      message: "The provider test did not return a JSON object.",
    });
    return;
  }
  finish(ctx, job.id, "succeeded", "ready", {
    latencyMs: Math.max(0, Date.now() - started),
    observedCapabilities: { imageInput: false, structuredOutput: ready.config.capabilities.structuredOutput },
  }, null);
}

async function runLayout(ctx: AppContext, job: JobDetail, signal: AbortSignal): Promise<void> {
  const request = layoutRequestOf(job);
  const projectId = job.projectId;
  if (!request || !projectId) {
    finish(ctx, job.id, "failed", "failed", null, { code: "REQUEST_INVALID", message: "The AI request is invalid." });
    return;
  }
  if (isDirectUndo(request.prompt)) {
    finish(ctx, job.id, "succeeded", "ready", {
      kind: "unsupported",
      reason: "Undo uses the history stack and was not sent to the model.",
    }, null);
    return;
  }
  const ready = openProvider(ctx, job);
  if (!ready) return;
  const revision = getRevision(ctx.db, projectId, request.baseRevision);
  if (!revision) {
    finish(ctx, job.id, "failed", "failed", null, { code: "NOT_FOUND", message: "That revision was not found." });
    return;
  }
  const scene = buildScene(revision.document, {
    baseRevision: request.baseRevision,
    configRevision: ready.provider.configRevision,
    selectedPanelIds: request.selectedPanelIds,
  });
  const preview = request.includePreviewImage && ready.config.capabilities.imageInput
    ? tryPng(ctx, projectId, revision.document, request.baseRevision)
    : null;
  setPhase(ctx, job.id, "requesting-intent");
  const resolved = await resolveModelIntent({
    config: ready.config,
    secret: ready.secret,
    prompt: request.prompt,
    scene,
    replyLocale: request.replyLocale,
    previewPng: preview,
    fetchImpl: ctx.aiFetch,
    signal,
  });
  if (!stillCurrent(ctx, job.id, ready.provider.configRevision)) return;
  if (!resolved.ok) {
    finish(ctx, job.id, "failed", "failed", null, { code: "MODEL_OUTPUT_INVALID", message: resolved.message });
    return;
  }
  if (!isAIIntent(resolved.intent)) {
    finish(ctx, job.id, "failed", "failed", null, { code: "MODEL_OUTPUT_INVALID", message: "The model output is not a valid intent." });
    return;
  }
  if (resolved.intent.kind === "clarification") {
    finish(ctx, job.id, "succeeded", "ready", {
      kind: "clarification",
      question: resolved.intent.question,
      ...(resolved.intent.options ? { options: resolved.intent.options } : {}),
    }, null);
    return;
  }
  if (resolved.intent.kind === "unsupported") {
    finish(ctx, job.id, "succeeded", "ready", { kind: "unsupported", reason: resolved.intent.reason }, null);
    return;
  }
  setPhase(ctx, job.id, "compiling");
  let compiled = compileProposal(revision.document, resolved.intent, assetLookup(ctx, projectId));
  let intent = resolved.intent;
  const calls = resolved.calls;
  if (request.visualReview && ready.config.capabilities.imageInput && calls < RESOURCE_LIMITS.aiModelCallBudget) {
    const reviewPng = tryPng(ctx, projectId, compiled.previewDocument, request.baseRevision);
    if (reviewPng && stillCurrent(ctx, job.id, ready.provider.configRevision)) {
      setPhase(ctx, job.id, "reviewing");
      const reviewed = await reviewModelIntent({
        config: ready.config,
        secret: ready.secret,
        scene,
        replyLocale: request.replyLocale,
        proposalJson: canonicalJson(intent),
        previewPng: reviewPng,
        fetchImpl: ctx.aiFetch,
        signal,
      });
      if (!stillCurrent(ctx, job.id, ready.provider.configRevision)) return;
      if (!reviewed.ok) {
        compiled = {
          ...compiled,
          diagnostics: [
            ...compiled.diagnostics,
            { code: "AI_REVIEW_IGNORED", severity: "info", messageKey: "ai.reviewIgnored", params: {} },
          ],
        };
      } else if (reviewed.intent.kind === "clarification") {
        finish(ctx, job.id, "succeeded", "ready", {
          kind: "clarification",
          question: reviewed.intent.question,
          ...(reviewed.intent.options ? { options: reviewed.intent.options } : {}),
        }, null);
        return;
      } else if (reviewed.intent.kind === "unsupported") {
        finish(ctx, job.id, "succeeded", "ready", { kind: "unsupported", reason: reviewed.intent.reason }, null);
        return;
      } else {
        intent = reviewed.intent;
        compiled = compileProposal(revision.document, intent, assetLookup(ctx, projectId));
      }
    }
  }
  if (!stillCurrent(ctx, job.id, ready.provider.configRevision)) return;
  const candidate = storeCandidate(ctx, projectId, request.baseRevision, compiled);
  finish(ctx, job.id, "succeeded", "ready", { kind: "candidates", candidates: [candidate] }, null);
}

function storeCandidate(
  ctx: AppContext,
  projectId: string,
  baseRevision: number,
  compiled: ReturnType<typeof compileProposal>,
): Candidate {
  const id = deterministicUuid({
    projectId,
    baseRevision,
    origin: "ai",
    summary: compiled.summary,
    commands: compiled.commands,
  });
  const now = ctx.now();
  insertCandidate(ctx.db, {
    id,
    projectId,
    baseRevision,
    origin: "ai",
    validationMode: compiled.validationMode,
    commands: compiled.commands,
    resultDocumentHash: hashFigureDocument(compiled.previewDocument),
    summary: compiled.summary,
    diagnostics: compiled.diagnostics,
    score: compiled.score,
    engineVersion: ENGINE_VERSIONS.layout,
    fontRegistryVersion: ENGINE_VERSIONS.fontRegistry,
    createdAt: now,
  });
  const candidate: Candidate = {
    id,
    projectId,
    baseRevision,
    origin: "ai",
    validationMode: compiled.validationMode,
    summary: compiled.summary,
    commands: compiled.commands,
    previewDocument: compiled.previewDocument,
    resultDocumentHash: hashFigureDocument(compiled.previewDocument),
    diagnostics: compiled.diagnostics,
    engineVersion: ENGINE_VERSIONS.layout,
    fontRegistryVersion: ENGINE_VERSIONS.fontRegistry,
  };
  if (!Check(CandidateSchema, candidate)) {
    throw new AiCompileError("DOCUMENT_INVALID", "The candidate could not be stored.");
  }
  return candidate;
}

function claim(ctx: AppContext, jobId: string): JobDetail | null {
  return immediate(ctx.db, () => {
    const job = getJobDetail(ctx.db, jobId);
    if (!job || job.status !== "queued") return null;
    if (job.cancelRequested) {
      finish(ctx, jobId, "cancelled", "cancelled", null, null);
      return null;
    }
    const provider = readProvider(ctx.db);
    const frozen = configRevisionOf(job);
    const direct = job.kind === "ai_layout" && isDirectUndo(layoutRequestOf(job)?.prompt ?? "");
    if (!direct && (!provider || !provider.encryptedSecret)) {
      finish(ctx, jobId, "failed", "failed", null, {
        code: "PROVIDER_NOT_CONFIGURED",
        message: "AI is not configured.",
      });
      return null;
    }
    if (!direct && provider && provider.configRevision !== frozen) {
      finish(ctx, jobId, "failed", "failed", null, {
        code: "PROVIDER_CONFIG_CHANGED",
        message: "The provider settings changed before this request started.",
      });
      return null;
    }
    const now = ctx.now();
    updateJobState(ctx.db, jobId, {
      status: "running",
      phase: job.kind,
      result: null,
      error: null,
      startedAt: now,
      finishedAt: null,
    });
    appendJobEvent(ctx.db, {
      jobId,
      event: "job.started",
      payloadJson: { status: "running", phase: job.kind, progress: null },
      createdAt: now,
    });
    return getJobDetail(ctx.db, jobId);
  });
}

function openProvider(ctx: AppContext, job: JobDetail): { provider: ProviderRecord; config: AIProviderConfig; secret: string } | null {
  const provider = readProvider(ctx.db);
  if (!provider || !provider.encryptedSecret) {
    finish(ctx, job.id, "failed", "failed", null, { code: "PROVIDER_NOT_CONFIGURED", message: "AI is not configured." });
    return null;
  }
  if (provider.configRevision !== configRevisionOf(job)) {
    finish(ctx, job.id, "failed", "failed", null, {
      code: "PROVIDER_CONFIG_CHANGED",
      message: "The provider settings changed before this request finished.",
    });
    return null;
  }
  let secret = "";
  try {
    secret = decryptSecret(masterKey(ctx.dataDir), provider.encryptedSecret);
  } catch {
    finish(ctx, job.id, "failed", "failed", null, {
      code: "PROVIDER_NOT_CONFIGURED",
      message: "The stored secret could not be read.",
    });
    return null;
  }
  const problem = settingsEndpointProblem(provider.config);
  if (problem) {
    finish(ctx, job.id, "failed", "failed", null, { code: "PROVIDER_NOT_CONFIGURED", message: problem });
    return null;
  }
  return { provider, config: provider.config, secret };
}

function stillCurrent(ctx: AppContext, jobId: string, seenRevision: number): boolean {
  const job = getJobDetail(ctx.db, jobId);
  if (!job || job.status !== "running") return false;
  if (job.cancelRequested) {
    finish(ctx, jobId, "cancelled", "cancelled", null, null);
    return false;
  }
  const provider = readProvider(ctx.db);
  if (!provider) {
    finish(ctx, jobId, "failed", "failed", null, { code: "PROVIDER_NOT_CONFIGURED", message: "AI is not configured." });
    return false;
  }
  if (provider.configRevision !== seenRevision) {
    finish(ctx, jobId, "failed", "failed", null, {
      code: "PROVIDER_CONFIG_CHANGED",
      message: "The provider settings changed before this request finished.",
    });
    return false;
  }
  return true;
}

function stopStaleAiJobs(ctx: AppContext, revision: number): void {
  for (const job of listActiveAiJobs(ctx.db)) {
    if (job.status !== "queued" || configRevisionOf(job) === revision) continue;
    finish(ctx, job.id, "failed", "failed", null, {
      code: "PROVIDER_CONFIG_CHANGED",
      message: "The provider settings changed before this request started.",
    });
  }
  for (const job of listActiveAiJobs(ctx.db)) {
    if (job.status === "running" && configRevisionOf(job) !== revision) inflight.get(job.id)?.abort();
  }
}

function finish(
  ctx: AppContext,
  jobId: string,
  status: "succeeded" | "failed" | "cancelled",
  phase: string,
  result: Job["result"],
  error: { code: ErrorCode; message: string } | null,
): void {
  const job = getJobDetail(ctx.db, jobId);
  if (!job || job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return;
  const now = ctx.now();
  const safeError = error ? { code: error.code, message: error.message.slice(0, 500) } : null;
  updateJobState(ctx.db, jobId, {
    status,
    phase,
    result,
    error: safeError,
    startedAt: job.startedAt,
    finishedAt: now,
  });
  appendJobEvent(ctx.db, {
    jobId,
    event: status === "failed" ? "job.failed" : status === "cancelled" ? "job.cancelled" : "job.completed",
    payloadJson: { status, phase, progress: null },
    createdAt: now,
  });
}

function setPhase(ctx: AppContext, jobId: string, phase: string): void {
  const job = getJobDetail(ctx.db, jobId);
  if (!job || job.status !== "running") return;
  const now = ctx.now();
  updateJobState(ctx.db, jobId, {
    status: "running",
    phase,
    result: null,
    error: null,
    startedAt: job.startedAt,
    finishedAt: null,
  });
  appendJobEvent(ctx.db, {
    jobId,
    event: "job.progress",
    payloadJson: { status: "running", phase, progress: null },
    createdAt: now,
  });
}

function settingsOf(row: ProviderRecord | null): AIProviderSettings {
  if (!row) return { configRevision: 0, hasSecret: false, config: null };
  return { configRevision: row.configRevision, hasSecret: row.encryptedSecret !== null, config: row.config };
}

function settingsEndpointProblem(config: AIProviderConfig): string | null {
  return endpointProblem(config.baseUrl, config.allowLocalEndpoint);
}

function configRevisionOf(job: JobDetail): number {
  const input = job.input;
  if (!input || typeof input !== "object" || !("configRevision" in input)) return 0;
  const value = (input as { configRevision?: unknown }).configRevision;
  return typeof value === "number" ? value : 0;
}

function layoutRequestOf(job: JobDetail): AILayoutRequest | null {
  const input = job.input;
  if (!input || typeof input !== "object" || !("request" in input)) return null;
  const request = (input as { request?: unknown }).request;
  return isAILayoutRequest(request) ? request : null;
}

function assetLookup(ctx: AppContext, projectId: string): AssetLookup {
  return (assetId) => {
    const asset = getAsset(ctx.db, assetId);
    if (!asset || asset.projectId !== projectId || asset.status !== "ready" || !asset.normalized) return null;
    return {
      id: asset.id,
      originalFilename: asset.originalFilename,
      viewport: asset.normalized.viewport,
      rasterPixelSize: asset.normalized.rasterPixelSize,
    };
  };
}

function tryPng(ctx: AppContext, projectId: string, document: FigureDocumentV1, revision: number): Uint8Array | null {
  try {
    return renderDocumentPng(ctx, projectId, document, revision, 512);
  } catch {
    return null;
  }
}

function mapFailure(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof AiCompileError || error instanceof DocumentCommandError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof AiTransportError) return { code: "REQUEST_INVALID", message: transportMessage(error) };
  if (error instanceof ApiException) return { code: error.code, message: error.message };
  return { code: "DOCUMENT_INVALID", message: "The request could not be completed." };
}

function requireProject(ctx: AppContext, projectId: string) {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new ApiException("NOT_FOUND", "The project was not found.");
  return project;
}

function requireJob(ctx: AppContext, jobId: string): Job {
  const job = getJob(ctx.db, jobId);
  if (!job) throw new ApiException("NOT_FOUND", "The job was not found.");
  return publicJob(job);
}

function takeReplay(ctx: AppContext, scope: string, key: string, requestHash: string): Response | null {
  const existing = getIdempotency(ctx.db, scope, key);
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new ApiException("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused for a different request.");
  }
  return { status: existing.httpStatus, body: JSON.parse(existing.responseJson) as unknown };
}

function remember(ctx: AppContext, scope: string, key: string, requestHash: string, status: number, body: unknown): void {
  insertIdempotency(ctx.db, {
    scope,
    key,
    requestHash,
    httpStatus: status,
    responseJson: JSON.stringify(body),
    createdAt: ctx.now(),
  });
}

function deterministicUuid(material: unknown): string {
  const hash = createHash("sha256").update(canonicalJson(material)).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError" && !isTimeout(error);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.message.toLowerCase().includes("timeout"));
}
