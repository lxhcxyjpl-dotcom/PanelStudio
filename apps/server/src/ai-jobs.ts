import { createHash, randomUUID } from "node:crypto";
import {
  AIProviderSettingsSchema,
  CandidateSchema,
  ENGINE_VERSIONS,
  RESOURCE_LIMITS,
  SSE_HEARTBEAT_INTERVAL_MS,
  isAILayoutRequest,
  isAIProviderConfig,
  isSecretWriteRequest,
  type AIIntent,
  type AILayoutJobResult,
  type AIProviderConfig,
  type AIProviderSettings,
  type Candidate,
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
import { validateCandidateResult } from "@panelstudio/layout";
import { currentEngines, frozenInput, materializeParent, prepareTurn, requestOf } from "./ai-context.js";
import {
  DocumentCommandError,
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

type Schedule = { pending: Set<Promise<void>>; requested: boolean; closing: boolean };
const schedules = new WeakMap<AppContext["db"], Schedule>();
const MAX_ACTIVE_PROVIDER_CALLS = 2;
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
    const provider = readProvider(ctx.db);
    const turn = prepareTurn(ctx, projectId, body, revision.document, revision.documentHash, provider?.configRevision ?? 0, assetLookup(ctx, projectId));
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
      inputJson: turn,
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
    if (job.status === "queued" || job.status === "running") {
      markCancelRequested(ctx.db, jobId);
      finish(ctx, jobId, "cancelled", "cancelled", null, null);
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

/** Stop a provider call that is still in flight after its project was soft-deleted. */
export function abortProjectJobs(ctx: AppContext, projectId: string): void {
  for (const [jobId, controller] of inflight) {
    const job = getJobDetail(ctx.db, jobId);
    if (job?.projectId === projectId) controller.abort();
  }
}

export function scheduleAiJobs(ctx: AppContext): void {
  if (ctx.deferAiJobs) return;
  const state = schedules.get(ctx.db) ?? { pending: new Set<Promise<void>>(), requested: false, closing: false };
  schedules.set(ctx.db, state);
  if (state.closing || state.requested || state.pending.size >= MAX_ACTIVE_PROVIDER_CALLS) return;
  state.requested = true;
  queueMicrotask(() => {
    state.requested = false;
    if (state.closing) return;
    const slots = MAX_ACTIVE_PROVIDER_CALLS - state.pending.size;
    for (const job of listQueuedAiJobs(ctx.db).slice(0, slots)) {
      const running = runAiJob(ctx, job.id).finally(() => {
        state.pending.delete(running);
        scheduleAiJobs(ctx);
      });
      state.pending.add(running);
      void running.catch(() => undefined);
    }
  });
}

/** Close connections only after outstanding provider completions have observed shutdown. */
export async function closeAiScheduler(ctx: AppContext): Promise<void> {
  const state = schedules.get(ctx.db);
  if (!state) return;
  state.closing = true;
  for (const job of listActiveAiJobs(ctx.db)) {
    if (job.status !== "running") continue;
    finish(ctx, job.id, "failed", "failed", null, {
      code: "SERVER_RESTARTED", message: "The server stopped before this request finished.",
    });
    inflight.get(job.id)?.abort();
  }
  await Promise.allSettled(state.pending);
  schedules.delete(ctx.db);
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
  const input = frozenInput(job);
  const projectId = job.projectId;
  if (!input || !projectId) throw new ApiException("AI_CONTEXT_INVALID", "The frozen draft context cannot be restored.");
  const { request } = input;
  if (isDirectUndo(request.prompt)) {
    finish(ctx, job.id, "succeeded", "ready", { kind: "unsupported", reason: "Undo uses the history stack." }, null);
    return;
  }
  const ready = openProvider(ctx, job);
  if (!ready) return;
  const root = getRevision(ctx.db, projectId, request.baseRevision);
  if (!root || root.documentHash !== input.rootHash || !currentEngines(input)) {
    throw new ApiException("CANDIDATE_STALE", "The root revision or engine version has changed.");
  }
  const assets = assetLookup(ctx, projectId);
  const work = materializeParent(ctx, projectId, request.baseRevision, root.document, input.parentCandidateId, assets);
  if (hashFigureDocument(work.document) !== input.sourceHash) throw new ApiException("CANDIDATE_STALE", "The draft input hash has changed.");
  const scope = { scope: request.scope ?? "document", selectedPanelIds: request.selectedPanelIds };
  const sceneInput = { ...scope, baseRevision: request.baseRevision,
    configRevision: input.configRevision, previousTurns: input.previousTurns };
  const scene = buildScene(work.document, sceneInput);
  const canRender = ready.config.capabilities.imageInput;
  const inputPng = canRender && (request.includePreviewImage || request.visualReview)
    ? await tryPng(ctx, projectId, work.document, request.baseRevision) : null;
  if (!stillCurrent(ctx, job.id, input.configRevision)) return;
  const providerInput = { config: ready.config, secret: ready.secret, replyLocale: request.replyLocale,
    prompt: request.prompt, scene, fetchImpl: ctx.aiFetch, signal };
  setPhase(ctx, job.id, "requesting-intent");
  const resolved = await resolveModelIntent({ ...providerInput, previewPng: request.includePreviewImage ? inputPng : null });
  if (!stillCurrent(ctx, job.id, input.configRevision)) return;
  if (!resolved.ok) throw new AiCompileError("MODEL_OUTPUT_INVALID", resolved.message);
  const publish = (makeResult: () => AILayoutJobResult) => immediate(ctx.db, () => {
    if (!stillCurrent(ctx, job.id, input.configRevision)) return;
    finish(ctx, job.id, "succeeded", "ready", makeResult(), null);
  });
  if (resolved.intent.kind !== "proposal") {
    const result = replyResult(resolved.intent);
    publish(() => result);
    return;
  }
  setPhase(ctx, job.id, "compiling");
  const compile = (intent: Extract<AIIntent, { kind: "proposal" }>) => {
    const delta = compileProposal(work.document, intent, assets, scope);
    const commands = [...(work.candidate?.commands ?? []), ...delta.commands];
    if (commands.length > RESOURCE_LIMITS.maxCommandsPerTransaction) {
      throw new AiCompileError("AI_CHAIN_LIMIT", "The cumulative draft exceeds 64 commands.", { reason: "command-limit" });
    }
    const validationMode = work.candidate?.validationMode === "layout" ? "layout" : delta.validationMode;
    const previewDocument = validateCandidateResult(root.document, commands, assets, validationMode);
    if (hashFigureDocument(previewDocument) !== hashFigureDocument(delta.previewDocument)) {
      throw new AiCompileError("DOCUMENT_INVALID", "Cumulative commands do not reproduce this round's draft.");
    }
    return { ...delta, commands, previewDocument, validationMode };
  };
  let compiled = compile(resolved.intent);
  let reviewCompleted = false;
  if (request.visualReview && inputPng && resolved.calls < RESOURCE_LIMITS.aiModelCallBudget) {
    const reviewPng = await tryPng(ctx, projectId, compiled.previewDocument, request.baseRevision);
    if (!stillCurrent(ctx, job.id, input.configRevision)) return;
    if (reviewPng) {
      setPhase(ctx, job.id, "reviewing");
      try {
        const reviewed = await reviewModelIntent({ ...providerInput, proposalJson: canonicalJson(resolved.intent),
          candidateScene: buildScene(compiled.previewDocument, sceneInput), previewPng: reviewPng, inputPng });
        if (!stillCurrent(ctx, job.id, input.configRevision)) return;
        if (reviewed.ok && reviewed.intent.kind !== "proposal") {
          const result = replyResult(reviewed.intent);
          publish(() => result);
          return;
        }
        if (reviewed.ok && reviewed.intent.kind === "proposal") {
          const adjusted = compile(reviewed.intent);
          // A changed picture has not been seen by the reviewer.
          reviewCompleted = hashFigureDocument(adjusted.previewDocument) === hashFigureDocument(compiled.previewDocument);
          compiled = adjusted;
        }
      } catch (error) {
        if (!stillCurrent(ctx, job.id, input.configRevision)) return;
        if (signal.aborted && isAbort(error) && !isTimeout(error)) throw error;
        // A failed optional review preserves the last fully validated draft.
      }
    }
  }
  if (request.visualReview) {
    compiled.diagnostics.push(reviewCompleted
      ? { code: "AI_REVIEW_COMPLETED", severity: "info", messageKey: "ai.reviewCompleted", params: {} }
      : { code: "AI_REVIEW_INCOMPLETE", severity: "warning", messageKey: "ai.reviewIncomplete", params: {} });
  }
  publish(() => ({ kind: "candidates", candidates: [storeCandidate(ctx, projectId, request.baseRevision, input.parentCandidateId, job.id, compiled)] }));
}

function replyResult(intent: Exclude<AIIntent, { kind: "proposal" }>): AILayoutJobResult {
  return intent.kind === "clarification"
    ? { kind: "clarification", question: intent.question, ...(intent.options ? { options: intent.options } : {}) }
    : { kind: "unsupported", reason: intent.reason };
}

function storeCandidate(
  ctx: AppContext, projectId: string, baseRevision: number, parentCandidateId: string | null,
  sourceJobId: string, compiled: ReturnType<typeof compileProposal>,
): Candidate {
  const version = { engineVersion: ENGINE_VERSIONS.layout, fontRegistryVersion: ENGINE_VERSIONS.fontRegistry };
  const id = deterministicUuid({ projectId, baseRevision, parentCandidateId, sourceJobId, ...version, commands: compiled.commands });
  const record = { id, projectId, baseRevision, parentCandidateId, sourceJobId, ...version, origin: "ai" as const,
    validationMode: compiled.validationMode, summary: compiled.summary, commands: compiled.commands,
    diagnostics: compiled.diagnostics, resultDocumentHash: hashFigureDocument(compiled.previewDocument) };
  const candidate: Candidate = { ...record, previewDocument: compiled.previewDocument };
  if (!Check(CandidateSchema, candidate)) throw new AiCompileError("DOCUMENT_INVALID", "The candidate could not be stored.");
  insertCandidate(ctx.db, { ...record, score: compiled.score, createdAt: ctx.now() });
  return candidate;
}

function claim(ctx: AppContext, jobId: string): JobDetail | null {
  return immediate(ctx.db, () => {
    const job = getJobDetail(ctx.db, jobId);
    if (!job || job.status !== "queued") return null;
    if (job.cancelRequested || projectDeleted(ctx, job)) {
      finish(ctx, jobId, "cancelled", "cancelled", null, null);
      return null;
    }
    const provider = readProvider(ctx.db);
    const frozen = configRevisionOf(job);
    const direct = job.kind === "ai_layout" && isDirectUndo(requestOf(job)?.prompt ?? "");
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

function projectDeleted(ctx: AppContext, job: { projectId: string | null }): boolean {
  if (!job.projectId) return false;
  return Boolean(getProject(ctx.db, job.projectId)?.deletedAt);
}

function stillCurrent(ctx: AppContext, jobId: string, seenRevision: number): boolean {
  const job = getJobDetail(ctx.db, jobId);
  if (!job || job.status !== "running") return false;
  if (job.cancelRequested || projectDeleted(ctx, job)) {
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
  const input = frozenInput(job);
  if (input && !currentEngines(input)) {
    finish(ctx, jobId, "failed", "failed", null, { code: "CANDIDATE_STALE", message: "The layout or font version changed." });
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
  ctx: AppContext, jobId: string, status: "succeeded" | "failed" | "cancelled", phase: string,
  result: Job["result"], error: Job["error"],
): void {
  immediate(ctx.db, () => {
    const job = getJobDetail(ctx.db, jobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    if (job.cancelRequested || projectDeleted(ctx, job)) {
      status = "cancelled";
      phase = "cancelled";
      error = null;
      result = null;
    } else if (status === "succeeded" && !isDirectUndo(requestOf(job)?.prompt ?? "")) {
      const provider = readProvider(ctx.db);
      const frozen = frozenInput(job);
      if (provider?.configRevision !== configRevisionOf(job) || (frozen && !currentEngines(frozen))) {
        status = "failed";
        phase = "failed";
        error = frozen && !currentEngines(frozen) ? { code: "CANDIDATE_STALE", message: "The layout or font version changed." }
          : { code: "PROVIDER_CONFIG_CHANGED", message: "The provider changed before publication." };
        result = null;
      }
    }
    const now = ctx.now();
    const safeError = error ? { ...error, message: error.message.slice(0, 500) } : null;
    updateJobState(ctx.db, jobId, { status, phase, result, error: safeError, startedAt: job.startedAt, finishedAt: now });
    appendJobEvent(ctx.db, { jobId, event: status === "failed" ? "job.failed" : status === "cancelled" ? "job.cancelled" : "job.completed",
      payloadJson: { status, phase, progress: null }, createdAt: now });
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


function assetLookup(ctx: AppContext, projectId: string): AssetLookup {
  return (assetId) => {
    const asset = getAsset(ctx.db, projectId, assetId);
    if (!asset || asset.status !== "ready" || !asset.normalized) return null;
    return {
      id: asset.id,
      originalFilename: asset.originalFilename,
      viewport: asset.normalized.viewport,
      rasterPixelSize: asset.normalized.rasterPixelSize,
    };
  };
}

async function tryPng(ctx: AppContext, projectId: string, document: FigureDocumentV1, revision: number): Promise<Uint8Array | null> {
  try {
    return await renderDocumentPng(ctx, projectId, document, revision, 512);
  } catch {
    return null;
  }
}

function mapFailure(error: unknown): NonNullable<Job["error"]> {
  if (error instanceof AiCompileError || error instanceof DocumentCommandError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof AiTransportError) return { code: "REQUEST_INVALID", message: transportMessage(error) };
  if (error instanceof ApiException) return { code: error.code, message: error.message, details: error.details };
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
