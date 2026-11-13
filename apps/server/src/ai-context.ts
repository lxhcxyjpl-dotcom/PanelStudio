import { Check } from "typebox/value";
import {
  AIFrozenInputSchema, AIHistoryCursorSchema, ENGINE_VERSIONS, MAX_AI_TURNS, isAILayoutRequest,
  type AIFrozenInput, type AIHistoryPage, type AIHistoryTurn, type AILayoutRequest, type FigureDocumentV1,
} from "@panelstudio/contracts";
import { DocumentCommandError, canonicalJson, hashFigureDocument, type AssetLookup } from "@panelstudio/core";
import { validateCandidateResult } from "@panelstudio/layout";
import { getCandidate, getJobDetail, getProject, getRevision, queryAiHistory, type CandidateRecord, type JobDetail, type KeyCursor } from "./db.js";
import { ApiException } from "./http.js";
import type { AppContext } from "./pipeline.js";
import { selectLayoutExamples } from "./layout-references.js";

export function frozenInput(job: JobDetail): AIFrozenInput | null {
  return Check(AIFrozenInputSchema, job.input) ? job.input : null;
}

export function requestOf(job: JobDetail): AILayoutRequest | null {
  const input = job.input;
  if (!input || typeof input !== "object" || !("request" in input)) return null;
  return isAILayoutRequest(input.request) ? input.request : null;
}

function normalizeSelection(document: FigureDocumentV1, ids: string[]): string[] {
  const unknown = ids.filter((id) => !document.panels[id]);
  if (unknown.length) throw new ApiException("REQUEST_INVALID", "A selected panel is missing from this draft.", { panelIds: unknown });
  const selected = new Set(ids);
  for (const group of Object.values(document.groups)) {
    if (group.panelIds.some((id) => selected.has(id))) group.panelIds.forEach((id) => selected.add(id));
  }
  return document.panelOrder.filter((id) => selected.has(id));
}

export function materializeParent(
  ctx: AppContext, projectId: string, rootRevision: number, root: FigureDocumentV1,
  candidateId: string | null, assets: AssetLookup,
): { document: FigureDocumentV1; candidate: CandidateRecord | null } {
  if (!candidateId) return { document: root, candidate: null };
  const candidate = getCandidate(ctx.db, candidateId);
  if (!candidate || candidate.projectId !== projectId || candidate.baseRevision !== rootRevision) {
    throw new ApiException("AI_CONTEXT_INVALID", "The selected draft does not belong to this project and root revision.");
  }
  if (!currentEngines(candidate)) throw new ApiException("CANDIDATE_STALE", "The draft uses a different layout or font version.");
  let document: FigureDocumentV1;
  try {
    document = validateCandidateResult(root, candidate.commands, assets, candidate.validationMode);
  } catch (error) {
    if (error instanceof DocumentCommandError) throw new ApiException(error.code, error.message, error.details);
    throw error;
  }
  if (hashFigureDocument(document) !== candidate.resultDocumentHash) throw new ApiException("CANDIDATE_STALE", "The draft hash does not match its commands.");
  return { document, candidate };
}

export function prepareTurn(
  ctx: AppContext, projectId: string, body: AILayoutRequest,
  root: FigureDocumentV1, rootHash: string, configRevision: number, assets: AssetLookup,
): AIFrozenInput {
  const context = body.context ?? { kind: "revision" };
  let parentId: string | null = context.kind === "candidate" ? context.candidateId : null;
  let prior: JobDetail | null = null;
  if (context.kind === "clarification") {
    prior = getJobDetail(ctx.db, context.jobId);
    if (!prior || prior.projectId !== projectId || prior.kind !== "ai_layout" || prior.status !== "succeeded" ||
      !prior.result || !("kind" in prior.result) || prior.result.kind !== "clarification" ||
      requestOf(prior)?.baseRevision !== body.baseRevision) {
      throw new ApiException("AI_CONTEXT_INVALID", "This question does not belong to the specified project, draft and revision.");
    }
    parentId = frozenInput(prior)?.parentCandidateId ?? null;
  }
  const work = materializeParent(ctx, projectId, body.baseRevision, root, parentId, assets);
  if (context.kind === "candidate" && work.candidate?.sourceJobId) {
    prior = getJobDetail(ctx.db, work.candidate.sourceJobId);
    if (!prior || prior.projectId !== projectId || prior.kind !== "ai_layout" || prior.status !== "succeeded" ||
      requestOf(prior)?.baseRevision !== body.baseRevision || !prior.result || !("kind" in prior.result) ||
      prior.result.kind !== "candidates" || !prior.result.candidates.some((item) => item.id === parentId)) {
      throw new ApiException("AI_CONTEXT_INVALID", "The draft's source turn cannot be restored.");
    }
  }
  const previous = prior ? requestOf(prior) : null;
  const saved = prior ? frozenInput(prior) : null;
  if (saved && (!currentEngines(saved) || saved.rootHash !== rootHash)) {
    throw new ApiException("CANDIDATE_STALE", "This turn belongs to a different engine version or original document.");
  }
  const previousTurns = [...(saved?.previousTurns ?? [])];
  if (prior && previous) {
    const result = prior.result;
    const clarification = result && "kind" in result && result.kind === "clarification" ? result : null;
    previousTurns.push({ prompt: previous.prompt, response: clarification?.question ?? work.candidate?.summary ?? "",
      ...(clarification?.options ? { options: clarification.options } : {}) });
  }
  if (previousTurns.length >= MAX_AI_TURNS) {
    throw new ApiException("AI_CHAIN_LIMIT", "A draft can contain at most ten turns, including clarifications.", { reason: "turn-limit" });
  }
  const inherited = previous && (context.kind === "clarification" || body.scope === undefined);
  const scope = inherited ? previous.scope ?? "document" : body.scope ?? "document";
  const selectedPanelIds = normalizeSelection(work.document, inherited ? previous.selectedPanelIds : body.selectedPanelIds);
  if (context.kind === "clarification" && (body.scope !== undefined && body.scope !== scope ||
    (body.selectedPanelIds.length > 0 || body.scope !== undefined) &&
    canonicalJson(normalizeSelection(work.document, body.selectedPanelIds)) !== canonicalJson(selectedPanelIds))) {
    throw new ApiException("AI_SCOPE_VIOLATION", "An answer must retain the original scope and selection.", { reason: "scope-conflict" });
  }
  if (scope === "selection" && !selectedPanelIds.length) throw new ApiException("AI_SCOPE_VIOLATION", "Select an object before using selection scope.", { reason: "empty-selection" });
  const sourceHash = hashFigureDocument(work.document);
  if (context.kind === "clarification" && saved && saved.sourceHash !== sourceHash) {
    throw new ApiException("CANDIDATE_STALE", "The question's input draft has changed.");
  }
  return {
    request: { ...body, context, scope, selectedPanelIds },
    configRevision, parentCandidateId: parentId, rootHash, sourceHash, previousTurns,
    engineVersion: ENGINE_VERSIONS.layout, fontRegistryVersion: ENGINE_VERSIONS.fontRegistry,
    layoutExamples: selectLayoutExamples(ctx, work.document),
  };
}

export function currentEngines(input: { engineVersion: string; fontRegistryVersion: string }): boolean {
  return input.engineVersion === ENGINE_VERSIONS.layout && input.fontRegistryVersion === ENGINE_VERSIONS.fontRegistry;
}

/** v0.1 jobs recorded the raw selection. Recover it against the original revision for display only. */
function legacyHistoryRequest(ctx: AppContext, projectId: string, job: JobDetail) {
  const input = job.input;
  const raw = input && typeof input === "object" && "request" in input ? input.request : null;
  if (!raw || typeof raw !== "object") throw new ApiException("DOCUMENT_INVALID", "The stored history turn is invalid.");
  const request = { ...raw, selectedPanelIds: [] as string[] };
  if (!isAILayoutRequest(request)) throw new ApiException("DOCUMENT_INVALID", "The stored history turn is invalid.");
  const selection: unknown = "selectedPanelIds" in raw ? raw.selectedPanelIds : null;
  if (!Array.isArray(selection)) return { request, damagedSelection: true };
  if (!selection.length) return { request, damagedSelection: false };
  const document = getRevision(ctx.db, projectId, request.baseRevision)?.document;
  if (!document) return { request, damagedSelection: true };
  const members = document.panelOrder.filter((id) => selection.includes(id));
  return { request: { ...request, selectedPanelIds: normalizeSelection(document, members) }, damagedSelection: members.length !== selection.length };
}

export function listAiHistory(ctx: AppContext, projectId: string, baseRevision: number | null, cursor: string | null, limit: number): AIHistoryPage {
  const project = getProject(ctx.db, projectId);
  if (!project) throw new ApiException("NOT_FOUND", "Project was not found.");
  let after: KeyCursor | null = null;
  if (cursor) {
    try {
      const data: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Check(AIHistoryCursorSchema, data) || data.projectId !== projectId || data.baseRevision !== baseRevision) throw new Error();
      after = { id: data.id, createdAt: data.createdAt };
    } catch {
      throw new ApiException("REQUEST_INVALID", "The history cursor does not match this query.");
    }
  }
  const page = queryAiHistory(ctx.db, projectId, baseRevision, after, limit);
  const items = page.items.map((job): AIHistoryTurn => {
    const saved = frozenInput(job);
    const { request, damagedSelection } = saved ? { request: saved.request, damagedSelection: false } : legacyHistoryRequest(ctx, projectId, job);
    const original = job.result;
    const result = original && "kind" in original ? original : null;
    const candidates = result?.kind === "candidates" ? result.candidates : [];
    const summary = candidates[0]?.summary;
    const isStale = Boolean(damagedSelection || project.deletedAt || request.baseRevision !== project.currentRevision || saved && !currentEngines(saved) || candidates.some((candidate) => !currentEngines(candidate)));
    return {
      jobId: job.id, projectId, baseRevision: request.baseRevision, context: request.context ?? { kind: "revision" },
      scope: request.scope ?? "document",
      resolvedSelectedPanelIds: request.selectedPanelIds,
      prompt: request.prompt, replyLocale: request.replyLocale, status: job.status, phase: job.phase,
      createdAt: job.createdAt, finishedAt: job.finishedAt, isStale,
      error: job.error ? { code: job.error.code, message: job.error.message, ...(job.error.details ? { details: job.error.details } : {}) } : null,
      result: result?.kind === "candidates" ? { kind: "candidates", candidateIds: candidates.map((item) => item.id),
        ...(typeof summary === "string" && summary.trim() ? { summary } : {}) }
        : result?.kind === "clarification" ? { kind: "clarification", question: result.question, ...(result.options ? { options: result.options } : {}) }
        : result?.kind === "unsupported" ? { kind: "unsupported", reason: result.reason } : null,
    };
  });
  const last = page.items.at(-1);
  const nextCursor = page.hasMore && last ? Buffer.from(JSON.stringify({ projectId, baseRevision, createdAt: last.createdAt, id: last.id })).toString("base64url") : null;
  return { items, nextCursor };
}
