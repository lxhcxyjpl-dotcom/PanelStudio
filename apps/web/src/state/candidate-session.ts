import type { AIContext, AIEditScope, AIHistoryTurn, Candidate, FigureDocumentV1, Job, LayoutRequest } from "@panelstudio/contracts";
import { api, ApiClientError, newKey } from "../api/client";
import { i18n } from "../i18n";
import { completePanelIds, panelIdsOf } from "../model/document-ui";
import { errorText } from "../model/feedback";
import { patch, useWorkspace } from "./store";
import { candidatesStale, type FrozenScope, type WorkspaceState } from "./types";

type Origin = {
  projectId: string;
  projectEpoch: number;
  requestSequence: number;
  jobId: string | null;
  baseRevision: number;
  contextId: string | null;
  cancelRequested: boolean;
};
type Root = NonNullable<WorkspaceState["candidateRoot"]>;
type AIOptions = { includePreviewImage: boolean; visualReview: boolean; fromCurrent?: boolean; onQueued?: (id:string) => void };
let epoch = 0;
let sequence = 0;
let active: Origin | null = null;
let historySequence = 0;
let thumbnailSet = 0;
const get = useWorkspace.getState;

export function projectEpoch() { return epoch; }
export function belongsToProject(projectId: string | null, ticket: number) {
  return get().projectId === projectId && ticket === epoch;
}
function begin(projectId: string, baseRevision: number, contextId: string | null = null): Origin {
  active = { projectId, projectEpoch: epoch, requestSequence: ++sequence, jobId: null, baseRevision, contextId, cancelRequested: false };
  return active;
}
function current(origin: Origin) {
  return active === origin && origin.requestSequence === sequence && belongsToProject(origin.projectId, origin.projectEpoch);
}

function releaseCards() {
  thumbnailSet++;
  for (const card of get().cards) if (card.previewUrl) URL.revokeObjectURL(card.previewUrl);
}
export function resetCandidateSession(projectId: string | null) {
  epoch++;
  sequence++;
  historySequence++;
  active = null;
  releaseCards();
  patch({
    cardLayoutRequest: null,
    inspectorMode: "properties",
    cards: [], activeCandidateId: null, candidateRoot: null, compareMode: "editing", aiScope: "document",
    frozenScope: null, scopeChanged: false, awaitingAnswer: null, aiHistory: [], historyCursor: null,
    aiStatus: { phase: "idle" }, layoutState: "idle", layoutMessage: null,
    aiPrompt: readPrompt(projectId), marquee: null, interaction: null, dragging: false, guides: [],
  });
  return epoch;
}
function readPrompt(id: string | null) {
  try { return sessionStorage.getItem(`panelstudio.prompt.${id ?? "new"}`) ?? ""; } catch { return ""; }
}
export function setPrompt(text: string) {
  patch({ aiPrompt: text });
  try { sessionStorage.setItem(`panelstudio.prompt.${get().projectId ?? "new"}`, text); } catch { /* The editor still keeps the input in memory. */ }
}
export function setScope(scope: AIEditScope) {
  patch({ aiScope: scope, scopeChanged: true });
}
export function activeScope(state: Pick<WorkspaceState,
  "aiStatus" | "awaitingAnswer" | "frozenScope" | "scopeChanged" | "cards" | "activeCandidateId" | "confirmed" | "aiScope" | "selection"
>, fromCurrent = false): FrozenScope {
  if (state.aiStatus.phase === "running") return state.aiStatus.frozen;
  if (!fromCurrent && state.awaitingAnswer) return state.awaitingAnswer;
  if (!fromCurrent && state.frozenScope && !state.scopeChanged) return state.frozenScope;
  const candidate = fromCurrent ? null : state.cards.find((card) => card.candidate.id === state.activeCandidateId)?.candidate;
  const document = candidate?.previewDocument ?? state.confirmed?.document;
  return { scope: state.aiScope, selectedPanelIds: document ? completePanelIds(document, panelIdsOf(state.selection, document)) : [] };
}

export function selectCandidate(id: string, compareMode: "original" | "draft" = "draft") {
  if (get().cards.some((card) => card.candidate.id === id)) patch({ activeCandidateId: id, compareMode, interaction: null });
}
export function continueEditing() { patch({ compareMode: "editing" }); }
export function dismissCandidates() {
  active = null;
  sequence++;
  releaseCards();
  patch({
    ...(get().inspectorMode === "layout" ? { inspectorMode: "properties" as const } : {}),
    cards: [], activeCandidateId: null, candidateRoot: null, compareMode: "editing",
    frozenScope: null, scopeChanged: false, awaitingAnswer: null, aiStatus: { phase: "idle" },
    layoutState: "idle", layoutMessage: null, liveMessage: i18n.t("ai.discarded"),
  });
}

function putCards(candidates: Candidate[], root: Root, frozen: FrozenScope | null, show: boolean) {
  releaseCards();
  const cards = candidates.map((candidate) => ({ candidate, previewUrl: null, previewError: null }));
  patch({
    cards, activeCandidateId: candidates[0]?.id ?? null, candidateRoot: root,
    compareMode: show && cards.length > 0 ? "draft" : "editing",
    frozenScope: frozen, aiScope: frozen?.scope ?? get().aiScope, scopeChanged: false,
    awaitingAnswer: null, layoutState: "idle", layoutMessage: null, aiStatus: { phase: "idle" },
  });
  if (cards.length) void thumbnails(candidates, thumbnailSet, epoch);
}
async function thumbnails(candidates: Candidate[], set: number, ticket: number) {
  await Promise.all(candidates.map(async (candidate) => {
    const valid = () => set === thumbnailSet && belongsToProject(candidate.projectId, ticket);
    const update = (previewUrl: string | null, previewError: string | null) => {
      if (valid()) patch({ cards: get().cards.map((card) => card.candidate.id === candidate.id ? { ...card, previewUrl, previewError } : card) });
    };
    try {
      const { jobId } = await api.preview(candidate.projectId, { source: { candidateId: candidate.id }, pixelWidth: 480 }, newKey());
      const job = await follow(jobId, valid);
      if (!job || !valid()) return;
      if (job.kind !== "preview" || job.status !== "succeeded") return update(null, i18n.t("layout.previewFailed"));
      const file = await api.download(`/artifacts/${job.result.artifactId}/download`);
      if (valid()) update(URL.createObjectURL(file.blob), null);
    } catch (error) { update(null, errorText(error)); }
  }));
}
async function follow(jobId: string, valid: () => boolean, progress?: (job: Job) => void) {
  while (valid()) {
    const job = await api.job(jobId);
    if (!valid()) return null;
    if (job.status !== "queued" && job.status !== "running") return job;
    progress?.(job);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300));
  }
  return null;
}

export async function generateLayout(request: LayoutRequest) {
  const { projectId, confirmed, draft } = get();
  if (!projectId || !confirmed) return;
  if (draft) return patch({ dialog: "recovery" });
  const origin = begin(projectId, confirmed.revision);
  patch({ layoutState: "loading", layoutMessage: null, compareMode: "editing", aiStatus: { phase: "idle" }, awaitingAnswer: null });
  try {
    const { candidates } = await api.layoutCandidates(projectId, { baseRevision: confirmed.revision, request, maxCandidates: request.family === "selection-row" ? 1 : 3 }, newKey());
    if (!current(origin)) return;
    putCards(candidates, confirmed, null, get().confirmed?.revision === confirmed.revision);
    patch({ cardLayoutRequest: request });
    return candidates.length > 0 && get().confirmed?.revision === confirmed.revision;
  } catch (error) {
    if (current(origin)) patch({ layoutState: error instanceof ApiClientError && error.code === "LAYOUT_CONFLICT" ? "conflict" : "error", layoutMessage: errorText(error), liveMessage: errorText(error) });
  }
}

export async function refreshAiHistory(reconnect = false, cursor?: string) {
  const { projectId } = get();
  if (!projectId) return;
  const ticket = epoch, request = ++historySequence, starting = sequence;
  try {
    const data = await api.aiHistory(projectId, cursor);
    if (!belongsToProject(projectId, ticket) || request !== historySequence) return;
    const all = cursor ? [...get().aiHistory, ...data.items] : data.items;
    patch({ aiHistory: [...new Map(all.map((turn) => [turn.jobId, turn])).values()], historyCursor: data.nextCursor });
    if (!reconnect || starting !== sequence) return;
    const running = data.items.find((t) => t.status === "queued" || t.status === "running");
    if (running) {
      const origin = begin(projectId, running.baseRevision, contextId(running.context));
      origin.jobId = running.jobId;
      const frozen = scopeOf(running);
      patch({ aiStatus: { phase: "running", jobId: running.jobId, baseRevision: running.baseRevision, prompt: running.prompt, frozen, label: i18n.t("ai.running") } });
      const root = await getRoot(origin);
      if (root && current(origin)) await finishAi(origin, root, frozen, false);
    }
  } catch (error) {
    if (belongsToProject(projectId, ticket) && request === historySequence) patch({ liveMessage: errorText(error) });
  }
}
function scopeOf(t: AIHistoryTurn): FrozenScope { return { scope: t.scope, selectedPanelIds: t.resolvedSelectedPanelIds }; }
function contextId(context: AIContext) {
  return context.kind === "candidate" ? context.candidateId : context.kind === "clarification" ? context.jobId : null;
}
async function getRoot(origin: Origin): Promise<Root | null> {
  const state = get();
  if (state.confirmed?.revision === origin.baseRevision) return state.confirmed;
  if (state.candidateRoot?.revision === origin.baseRevision) return state.candidateRoot;
  const revision = await api.revision(origin.projectId, origin.baseRevision);
  return current(origin) ? revision : null;
}
function askAgain(t: { jobId: string; baseRevision: number }, question: string, options: string[], frozen: FrozenScope) {
  patch({
    awaitingAnswer: { jobId: t.jobId, baseRevision: t.baseRevision, question, options, ...frozen },
    aiScope: frozen.scope, scopeChanged: false, aiStatus: { phase: "clarification", question, options }, liveMessage: question,
  });
}
export async function openHistoryTurn(turn: AIHistoryTurn) {
  if (!turn.result || get().aiStatus.phase === "running" || turn.projectId !== get().projectId) return;
  const origin = begin(turn.projectId, turn.baseRevision, turn.jobId);
  try {
    const root = await getRoot(origin);
    if (!root || !current(origin)) return;
    if (turn.result.kind === "candidates") {
      const cards = await Promise.all(turn.result.candidateIds.map((id) => api.candidate(turn.projectId, id)));
      if (current(origin)) putCards(cards, root, scopeOf(turn), true);
    } else if (turn.result.kind === "clarification" && !turn.isStale && root.revision === get().confirmed?.revision) {
      // Multiple questions can refer back to a candidate that predates the loaded history page.
      let context = turn.context;
      let history = get().aiHistory;
      let cursor = get().historyCursor;
      const visited = new Set<string>();
      while (context.kind === "clarification" && !visited.has(context.jobId)) {
        const id = context.jobId;
        visited.add(id);
        while (!history.some((t) => t.jobId === id) && cursor && current(origin)) {
          const page = await api.aiHistory(turn.projectId, cursor);
          history = [...history, ...page.items]; cursor = page.nextCursor;
        }
        const parent = history.find((t) => t.jobId === id);
        if (!parent) break;
        context = parent.context;
      }
      const cards = context.kind === "candidate" ? [await api.candidate(turn.projectId, context.candidateId)] : [];
      if (!current(origin)) return;
      putCards(cards, root, scopeOf(turn), false);
      askAgain(turn, turn.result.question, turn.result.options ?? [], scopeOf(turn));
    }
  } catch (error) { if (current(origin)) patch({ liveMessage: errorText(error) }); }
}

export async function generateAi(prompt: string, options: AIOptions) {
  const state = get();
  const { projectId, confirmed } = state;
  if (!projectId || !confirmed || !prompt.trim()) return;
  if (state.draft) return patch({ dialog: "recovery" });
  if (state.aiStatus.phase === "running") return;
  const fromCurrent = Boolean(options.fromCurrent);
  const answer = fromCurrent ? null : state.awaitingAnswer;
  const parent = fromCurrent ? null : state.cards.find((c) => c.candidate.id === state.activeCandidateId)?.candidate;
  if (!fromCurrent && (candidatesStale(state) || (answer && answer.baseRevision !== confirmed.revision))) return;
  const root = (parent || answer) && state.candidateRoot ? state.candidateRoot : confirmed;
  const frozen = activeScope(state, fromCurrent);
  if (frozen.scope === "selection" && !frozen.selectedPanelIds.length) return patch({ liveMessage: i18n.t("reason.empty-selection") });
  const context: AIContext = answer ? { kind: "clarification", jobId: answer.jobId } : parent ? { kind: "candidate", candidateId: parent.id } : { kind: "revision" };
  const origin = begin(projectId, root.revision, contextId(context));
  const running = { phase: "running" as const, jobId: null, baseRevision: root.revision, prompt, frozen, label: i18n.t("ai.running") };
  patch({ aiStatus: running, layoutState: "idle", liveMessage: running.label });
  try {
    const { jobId } = await api.aiLayout(projectId, {
      baseRevision: root.revision, context,
      ...(answer || (parent?.origin === "ai" && !state.scopeChanged) ? {} : { scope: frozen.scope }),
      selectedPanelIds: frozen.selectedPanelIds, prompt: prompt.trim(), replyLocale: state.locale,
      includePreviewImage: options.includePreviewImage, visualReview: options.visualReview,
    }, newKey());
    origin.jobId = jobId;
    options.onQueued?.(jobId);
    if (origin.cancelRequested) { await api.cancelJob(jobId, newKey()); return; }
    if (!current(origin)) return;
    // Clear only the submitted text; preserve anything typed while the request was queued.
    if (get().aiPrompt === prompt) setPrompt("");
    patch({ aiStatus: { ...running, jobId } });
    void refreshAiHistory();
    await finishAi(origin, root, frozen, true);
  } catch (error) {
    if (current(origin)) failAi(error);
  } finally {
    if (current(origin)) {
      if (["failed", "unsupported"].includes(get().aiStatus.phase) && !get().aiPrompt) setPrompt(prompt);
      void refreshAiHistory();
    }
  }
}
function failAi(error: unknown) {
  const code = error instanceof ApiClientError ? error.code : "NETWORK";
  const message = code === "MODEL_OUTPUT_INVALID" ? i18n.t("ai.invalidOutput") : code === "PROVIDER_CONFIG_CHANGED" ? i18n.t("ai.configChanged") : errorText(error);
  patch({ aiStatus: { phase: "failed", code, message }, liveMessage: message });
}
async function finishAi(origin: Origin, root: Root, frozen: FrozenScope, show: boolean) {
  if (!origin.jobId) return;
  const job = await follow(origin.jobId, () => current(origin), (j) => {
    const status = get().aiStatus;
    if (status.phase === "running") patch({ aiStatus: { ...status, label: i18n.t(`ai.phase.${j.phase}`, { defaultValue: i18n.t("ai.running") }) } });
  });
  if (!job || !current(origin)) return;
  if (job.status === "cancelled") patch({ aiStatus: { phase: "cancelled" }, liveMessage: i18n.t("ai.cancelled") });
  else if (job.status === "failed") failAi(new ApiClientError(job.error.message, 422, job.error.code, job.error.details ?? {}));
  else if (job.kind === "ai_layout" && job.status === "succeeded") {
    if (job.result.kind === "clarification") {
      patch({ candidateRoot: root });
      askAgain({ jobId: job.id, baseRevision: root.revision }, job.result.question, job.result.options ?? [], frozen);
    } else if (job.result.kind === "unsupported") {
      patch({ aiStatus: { phase: "unsupported", reason: job.result.reason }, liveMessage: job.result.reason });
    } else {
      const stale = root.revision !== get().confirmed?.revision;
      putCards(job.result.candidates, root, frozen, show && !stale);
      patch({ liveMessage: i18n.t(stale ? "ai.stale" : "ai.ready") });
    }
  }
  void refreshAiHistory();
}
export async function followEditedAi(jobId: string, prompt: string, frozen: FrozenScope) {
  const state = get();
  if (!state.projectId || !state.confirmed) return;
  const origin = begin(state.projectId, state.confirmed.revision);
  origin.jobId = jobId;
  patch({ inspectorMode:"ai", rightOpen:true, aiScope:frozen.scope, frozenScope:frozen, scopeChanged:false,
    aiStatus:{phase:"running",jobId,prompt,frozen,baseRevision:state.confirmed.revision,label:i18n.t("ai.running")} });
  void refreshAiHistory();
  try { await finishAi(origin,state.confirmed,frozen,true); }
  catch (error) { if (current(origin)) failAi(error); }
}
export async function cancelAiPrompt() {
  const origin = active;
  const status = get().aiStatus;
  if (!origin || status.phase !== "running") return;
  if (!get().aiPrompt) setPrompt(status.prompt);
  origin.cancelRequested = true;
  active = null;
  const ticket = ++sequence;
  patch({ aiStatus: { phase: "cancelled" }, liveMessage: i18n.t("ai.cancelled") });
  try {
    if (origin.jobId) await api.cancelJob(origin.jobId, newKey());
    if (sequence === ticket && belongsToProject(origin.projectId, origin.projectEpoch)) void refreshAiHistory();
  } catch (error) {
    if (sequence === ticket && belongsToProject(origin.projectId, origin.projectEpoch)) failAi(error);
  }
}
