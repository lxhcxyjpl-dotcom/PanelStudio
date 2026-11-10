import {
  RESOURCE_LIMITS,
  type Asset,
  type Diagnostic,
  type DomainCommand,
  type ExportRequest,
  type FigureDocumentV1,
} from "@panelstudio/contracts";
import { applyCommands, DocumentCommandError, type AssetLookup } from "@panelstudio/core/apply";
import {
  alignSelection,
  distributeSelection,
  equalSizeSelection,
  translateSelection,
} from "@panelstudio/core/arrange";
import { stackOrderCommand, type StackMove } from "@panelstudio/core/stack";
import { api, ApiClientError, newKey, thumbnailUrl, waitForJob, type AssetPage } from "../api/client";
import { i18n } from "../i18n";
import { cropInvalid, geometryLocked, groupForPanel, mergedOverrides, panelIdsOf } from "../model/document-ui";
import { placePanelCommands } from "../model/place";
import { readProjectId, writeProjectId } from "../prefs";
import { clearRecovery, readRecovery, writeRecovery, type RecoveryDraft } from "./drafts";
import { queryClient } from "./query";
import { patch, syncChrome, useWorkspace } from "./store";
import { baseDocument, type Confirmed, type ImportRow, type PendingDraft } from "./types";

import rasterUrl from "../../../../fixtures/mixed/raster.png";
import photoUrl from "../../../../fixtures/mixed/photo.jpg";
import vectorUrl from "../../../../fixtures/mixed/panel-vector.svg";

let chain: Promise<void> = Promise.resolve();
let bootStarted = false;
let nudgeTimer = 0;
let nudge: { ids: string[]; dx: number; dy: number } | null = null;

function later(task: () => Promise<void>): Promise<void> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function assetLookup(): AssetLookup {
  const projectId = useWorkspace.getState().projectId;
  return projectId ? lookupFor(projectId) : () => null;
}

export function readyViewport(assetId: string): { width: number; height: number } | null {
  return assetLookup()(assetId)?.viewport ?? null;
}

function lookupFor(projectId: string): AssetLookup {
  return (assetId) => {
    const page = queryClient.getQueryData<AssetPage>(["assets", projectId]);
    const asset = page?.items.find((item) => item.id === assetId);
    if (!asset || asset.status !== "ready" || !asset.normalized) return null;
    return {
      id: asset.id,
      originalFilename: asset.originalFilename,
      viewport: asset.normalized.viewport,
      rasterPixelSize: asset.normalized.rasterPixelSize,
    };
  };
}

function say(message: string): void {
  patch({ liveMessage: message });
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    const key = `errors.${error.code}`;
    const translated = i18n.t(key);
    return translated === key ? error.message : translated;
  }
  if (error instanceof DocumentCommandError) return i18n.t(`errors.${error.code}`);
  return i18n.t("errors.generic");
}

function recoveryOf(draft: PendingDraft, projectId: string): RecoveryDraft {
  return {
    kind: "recovery-draft",
    includesSourceAssets: false,
    purpose: "Figure document and unconfirmed commands only. Not a .figurezip and it does not include source assets.",
    projectId,
    baseRevision: draft.baseRevision,
    document: draft.document,
    pendingCommands: draft.commands,
    savedAt: new Date().toISOString(),
  };
}

async function remember(draft: PendingDraft | null, projectId: string | null): Promise<void> {
  if (!projectId) return;
  if (!draft) {
    await clearRecovery(projectId);
    return;
  }
  await writeRecovery(recoveryOf(draft, projectId));
}

export async function boot(): Promise<void> {
  if (bootStarted) return;
  bootStarted = true;
  const state = useWorkspace.getState();
  syncChrome(state);
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", () => syncChrome(useWorkspace.getState()));
  try {
    await api.health();
    patch({ backend: "ok" });
  } catch {
    patch({ backend: "down", booting: false, saveState: "offline" });
    return;
  }
  const projectId = readProjectId();
  if (!projectId) {
    patch({ booting: false });
    return;
  }
  try {
    await loadProject(projectId, true);
  } catch {
    writeProjectId(null);
    patch({ projectId: null, booting: false, liveMessage: i18n.t("app.projectMissing") });
  }
}

export async function loadProject(projectId: string, fromBoot = false): Promise<void> {
  const project = await api.project(projectId);
  const document = await api.document(projectId);
  const assets = await api.assets(projectId);
  queryClient.setQueryData(["assets", projectId], assets);
  writeProjectId(projectId);
  const confirmed: Confirmed = {
    revision: document.revision,
    document: document.document,
    documentHash: document.documentHash,
    history: document.history,
  };
  patch({
    projectId,
    title: project.title,
    confirmed,
    draft: null,
    optimistic: null,
    interaction: null,
    crop: null,
    selection: { kind: "none" },
    cards: [],
    activeCandidateId: null,
    aiStatus: { phase: "idle" },
    saveState: "saved",
    booting: false,
    fittedProjectId: null,
    historyRetry: null,
    serverSnapshot: null,
    dialog: null,
  });
  if (!fromBoot) return;
  const saved = await readRecovery(projectId).catch(() => null);
  if (!saved || saved.pendingCommands.length === 0) return;
  patch({
    draft: {
      baseRevision: saved.baseRevision,
      commands: saved.pendingCommands,
      document: saved.document,
      idempotencyKey: newKey(),
      reason: saved.baseRevision === confirmed.revision ? "network" : "conflict",
    },
    serverSnapshot: confirmed,
    saveState: saved.baseRevision === confirmed.revision ? "failed" : "conflict",
    dialog: "recovery",
    liveMessage: i18n.t(saved.baseRevision === confirmed.revision ? "save.failed" : "save.conflict"),
  });
}

export async function ensureProject(): Promise<string> {
  const current = useWorkspace.getState();
  if (current.projectId && current.confirmed) return current.projectId;
  const title = current.locale === "zh-CN" ? "未命名图稿" : "Untitled figure";
  const created = await api.createProject(title, newKey());
  const fresh = await api.document(created.project.id);
  writeProjectId(created.project.id);
  queryClient.setQueryData(["assets", created.project.id], { items: [], nextCursor: null });
  patch({
    projectId: created.project.id,
    title: created.project.title,
    confirmed: {
      revision: fresh.revision,
      document: fresh.document,
      documentHash: fresh.documentHash,
      history: fresh.history,
    },
    saveState: "saved",
    fittedProjectId: null,
    selection: { kind: "none" },
  });
  return created.project.id;
}

export function reloadFromServer(): Promise<void> {
  const { projectId, draft } = useWorkspace.getState();
  if (!projectId) return Promise.resolve();
  if (draft) {
    patch({ dialog: "recovery", liveMessage: i18n.t("save.conflict") });
    return Promise.resolve();
  }
  return loadProject(projectId);
}

export function openListedProject(projectId: string): Promise<void> {
  const state = useWorkspace.getState();
  if (state.draft && state.projectId && state.projectId !== projectId) {
    patch({ dialog: "recovery", liveMessage: i18n.t("save.conflict") });
    return Promise.resolve();
  }
  if (state.projectId === projectId) return reloadFromServer();
  return loadProject(projectId);
}

export async function deleteCurrentProject(): Promise<void> {
  const state = useWorkspace.getState();
  if (!state.projectId) return;
  if (state.draft) {
    patch({ dialog: "recovery", liveMessage: i18n.t("save.failed") });
    return;
  }
  const projectId = state.projectId;
  await api.deleteProject(projectId);
  await clearRecovery(projectId);
  writeProjectId(null);
  patch({
    projectId: null,
    confirmed: null,
    title: "",
    draft: null,
    optimistic: null,
    interaction: null,
    crop: null,
    guides: [],
    guidesFading: false,
    selection: { kind: "none" },
    cards: [],
    activeCandidateId: null,
    layoutState: "idle",
    layoutMessage: null,
    imports: [],
    dialog: null,
    assetInfoId: null,
    quota: null,
    exportState: null,
    saveState: "idle",
    fittedProjectId: null,
    historyRetry: null,
    serverSnapshot: null,
    aiStatus: { phase: "idle" },
    liveMessage: i18n.t("toolbar.projectDeleted"),
  });
}

export async function restoreListedProject(projectId: string): Promise<void> {
  const state = useWorkspace.getState();
  if (state.draft && state.projectId && state.projectId !== projectId) {
    patch({ dialog: "recovery", liveMessage: i18n.t("save.conflict") });
    return;
  }
  await api.restoreProject(projectId, newKey());
  await loadProject(projectId);
  patch({ liveMessage: i18n.t("toolbar.projectRestored") });
}

export async function renameTitle(title: string): Promise<void> {
  const { projectId } = useWorkspace.getState();
  if (!projectId) return;
  const project = await api.renameProject(projectId, title);
  patch({ title: project.title, liveMessage: i18n.t("save.saved") });
}

export async function importFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const projectId = await ensureProject();
  const ready: string[] = [];
  let failed = 0;
  for (const file of files) {
    const row: ImportRow = { id: newKey(), filename: file.name, status: "importing", message: null, code: null };
    patch({ imports: [...useWorkspace.getState().imports, row] });
    try {
      const accepted = await api.uploadAsset(projectId, file, newKey());
      const job = await waitForJob(accepted.jobId);
      if (job.status !== "succeeded") {
        failed += 1;
        replaceImport(row.id, {
          status: "failed",
          code: job.status === "failed" ? job.error.code : "REQUEST_INVALID",
          message: job.status === "failed" ? job.error.message : i18n.t("errors.generic"),
        });
        continue;
      }
      ready.push(accepted.assetId);
      replaceImport(row.id, { status: "ready", message: null, code: null });
    } catch (error) {
      failed += 1;
      replaceImport(row.id, {
        status: "failed",
        code: error instanceof ApiClientError ? error.code : "NETWORK",
        message: errorText(error),
      });
    }
  }
  await queryClient.refetchQueries({ queryKey: ["assets", projectId] });
  if (failed > 0) say(i18n.t("assets.partial"));
  if (ready.length > 0) await offerAssets(ready);
}

function replaceImport(id: string, next: Partial<ImportRow>): void {
  patch({
    imports: useWorkspace.getState().imports.map((row) => (row.id === id ? { ...row, ...next } : row)),
  });
}

export async function offerAssets(assetIds: string[]): Promise<void> {
  const state = useWorkspace.getState();
  const count = Object.keys(state.confirmed?.document.panels ?? {}).length;
  const remaining = RESOURCE_LIMITS.maxPanelsPerProject - count;
  if (remaining <= 0 || assetIds.length > remaining) {
    patch({ quota: { assetIds, remaining: Math.max(0, remaining) }, dialog: "quota" });
    say(i18n.t("assets.remaining", { count: Math.max(0, remaining) }));
    return;
  }
  await placeAssets(assetIds);
}

export function placeAssets(assetIds: string[]): Promise<void> {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document || !state.projectId) return Promise.resolve();
  const lookup = lookupFor(state.projectId);
  const additions = assetIds.flatMap((assetId) => {
    const facts = lookup(assetId);
    if (!facts) return [];
    return [{ panelId: newKey(), assetId, viewport: facts.viewport }];
  });
  if (additions.length === 0) return Promise.resolve();
  return transact(placePanelCommands(document, additions));
}

export async function openSample(): Promise<void> {
  const files = await Promise.all([
    fileFromUrl(rasterUrl, "raster.png", "image/png"),
    fileFromUrl(photoUrl, "photo.jpg", "image/jpeg"),
    fileFromUrl(vectorUrl, "panel-vector.svg", "image/svg+xml"),
  ]);
  await importFiles(files);
}

async function fileFromUrl(url: string, name: string, type: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], name, { type });
}

export function transact(commands: DomainCommand[]): Promise<void> {
  return later(() => transactNow(commands));
}

async function transactNow(commands: DomainCommand[]): Promise<void> {
  const state = useWorkspace.getState();
  if (!state.projectId || !state.confirmed) return;
  if (state.draft) {
    patch({ dialog: "recovery", liveMessage: i18n.t("save.failed") });
    return;
  }
  let next: FigureDocumentV1;
  try {
    next = applyCommands(state.confirmed.document, commands, lookupFor(state.projectId));
  } catch (error) {
    say(errorText(error));
    return;
  }
  const idempotencyKey = newKey();
  patch({ saveState: "saving", optimistic: next, interaction: null, crop: null, activeCandidateId: null });
  try {
    const result = await api.transaction(state.projectId, { baseRevision: state.confirmed.revision, commands }, idempotencyKey);
    patch({
      confirmed: {
        revision: result.revision,
        document: result.document,
        documentHash: result.documentHash,
        history: result.history,
      },
      optimistic: null,
      draft: null,
      saveState: "saved",
      liveMessage: i18n.t("save.saved"),
    });
    await remember(null, state.projectId);
  } catch (error) {
    await keepFailedCommand(error, {
      baseRevision: state.confirmed.revision,
      commands,
      document: next,
      idempotencyKey,
      reason: "server",
    });
  }
}

async function keepFailedCommand(error: unknown, pending: PendingDraft): Promise<void> {
  const code = error instanceof ApiClientError ? error.code : "NETWORK";
  const status = error instanceof ApiClientError ? error.status : 0;
  const retain = status === 0 || status >= 500 || code === "REVISION_CONFLICT" || code === "NETWORK";
  if (!retain) {
    patch({ optimistic: null, saveState: "saved", liveMessage: errorText(error) });
    return;
  }
  const reason: PendingDraft["reason"] =
    code === "REVISION_CONFLICT" ? "conflict" : status === 0 || code === "NETWORK" ? "network" : "server";
  const draft = { ...pending, reason };
  patch({
    draft,
    optimistic: null,
    saveState: reason === "network" ? "offline" : reason === "conflict" ? "conflict" : "failed",
    dialog: "recovery",
    liveMessage: i18n.t(reason === "network" ? "save.offline" : reason === "conflict" ? "save.conflict" : "save.failed"),
  });
  const projectId = useWorkspace.getState().projectId;
  if (projectId && reason === "conflict") {
    try {
      const server = await api.document(projectId);
      patch({
        serverSnapshot: {
          revision: server.revision,
          document: server.document,
          documentHash: server.documentHash,
          history: server.history,
        },
      });
    } catch {
      patch({ backend: "down" });
    }
  }
  if (projectId) await remember(draft, projectId);
}

export async function retrySave(reapply: boolean): Promise<void> {
  const state = useWorkspace.getState();
  if (state.historyRetry && state.projectId) {
    await runHistory(state.historyRetry.direction, state.historyRetry.baseRevision, state.historyRetry.idempotencyKey);
    return;
  }
  const draft = state.draft;
  if (!draft || !state.projectId) return;
  const baseRevision = reapply && state.serverSnapshot ? state.serverSnapshot.revision : draft.baseRevision;
  const key = reapply ? newKey() : draft.idempotencyKey;
  patch({ saveState: "saving" });
  try {
    const result = await api.transaction(state.projectId, { baseRevision, commands: draft.commands }, key);
    patch({
      confirmed: {
        revision: result.revision,
        document: result.document,
        documentHash: result.documentHash,
        history: result.history,
      },
      draft: null,
      optimistic: null,
      saveState: "saved",
      dialog: null,
      serverSnapshot: null,
      liveMessage: i18n.t("save.saved"),
    });
    await remember(null, state.projectId);
  } catch (error) {
    await keepFailedCommand(error, { ...draft, baseRevision, idempotencyKey: key });
  }
}

export async function discardDraft(): Promise<void> {
  const { projectId } = useWorkspace.getState();
  if (!projectId) return;
  const server = useWorkspace.getState().serverSnapshot;
  if (server) {
    patch({
      confirmed: server,
      draft: null,
      optimistic: null,
      saveState: "saved",
      dialog: null,
      serverSnapshot: null,
      historyRetry: null,
      liveMessage: i18n.t("save.saved"),
    });
  } else {
    await loadProject(projectId);
  }
  await remember(null, projectId);
}

export function downloadRecovery(): void {
  const state = useWorkspace.getState();
  if (!state.projectId) return;
  const document = state.draft?.document ?? state.confirmed?.document;
  if (!document) return;
  const payload = recoveryOf(
    state.draft ?? {
      baseRevision: state.confirmed?.revision ?? 0,
      commands: [],
      document,
      idempotencyKey: "",
      reason: "server",
    },
    state.projectId,
  );
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  clickDownload(blob, "panelstudio-recovery.json");
}

export function undo(): Promise<void> {
  return history("undo");
}

export function redo(): Promise<void> {
  return history("redo");
}

function history(direction: "undo" | "redo"): Promise<void> {
  return later(async () => {
    const state = useWorkspace.getState();
    if (!state.projectId || !state.confirmed) {
      say(i18n.t(direction === "undo" ? "history.undoEmpty" : "history.redoEmpty"));
      return;
    }
    if (state.draft) {
      patch({ dialog: "recovery" });
      return;
    }
    const allowed = direction === "undo" ? state.confirmed.history.canUndo : state.confirmed.history.canRedo;
    if (!allowed) {
      say(i18n.t(direction === "undo" ? "history.undoEmpty" : "history.redoEmpty"));
      return;
    }
    await runHistory(direction, state.confirmed.revision, newKey());
  });
}

async function runHistory(direction: "undo" | "redo", baseRevision: number, key: string): Promise<void> {
  const { projectId } = useWorkspace.getState();
  if (!projectId) return;
  patch({ saveState: "saving", historyRetry: null });
  try {
    const result = direction === "undo" ? await api.undo(projectId, baseRevision, key) : await api.redo(projectId, baseRevision, key);
    patch({
      confirmed: {
        revision: result.revision,
        document: result.document,
        documentHash: result.documentHash,
        history: result.history,
      },
      optimistic: null,
      saveState: "saved",
      activeCandidateId: null,
      historyRetry: null,
      liveMessage: i18n.t(direction === "undo" ? "history.undone" : "history.redone"),
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "REQUEST_INVALID") {
      patch({ saveState: "saved", liveMessage: i18n.t(direction === "undo" ? "history.undoEmpty" : "history.redoEmpty") });
      return;
    }
    const status = error instanceof ApiClientError ? error.status : 0;
    if (status === 0 || status >= 500) {
      patch({
        saveState: status === 0 ? "offline" : "failed",
        historyRetry: { direction, baseRevision, idempotencyKey: key },
        dialog: "recovery",
        liveMessage: i18n.t(status === 0 ? "save.offline" : "save.failed"),
      });
      return;
    }
    patch({ saveState: "saved", liveMessage: errorText(error) });
  }
}

export function queueNudge(ids: string[], dx: number, dy: number): void {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document || !state.projectId || state.draft || ids.length === 0) return;
  if (!nudge) nudge = { ids, dx: 0, dy: 0 };
  nudge.dx += dx;
  nudge.dy += dy;
  try {
    const command = translateSelection(document, nudge.ids, nudge.dx, nudge.dy);
    const preview = applyCommands(document, [command], lookupFor(state.projectId));
    patch({ interaction: preview, activeCandidateId: null });
  } catch (error) {
    say(errorText(error));
  }
  window.clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => {
    void flushNudge();
  }, 320);
}

async function flushNudge(): Promise<void> {
  const current = nudge;
  nudge = null;
  if (!current || (current.dx === 0 && current.dy === 0)) {
    patch({ interaction: null });
    return;
  }
  const document = baseDocument(useWorkspace.getState());
  patch({ interaction: null });
  if (!document) return;
  await transact([translateSelection(document, current.ids, current.dx, current.dy)]);
}

export function requestLayout(): Promise<void> {
  return later(() => requestLayoutNow());
}

async function requestLayoutNow(): Promise<void> {
  const state = useWorkspace.getState();
  const document = state.confirmed?.document;
  if (!state.projectId || !state.confirmed || !document) return;
  const count = document.panelOrder.length;
  if (count < RESOURCE_LIMITS.minAutoLayoutPanels || count > RESOURCE_LIMITS.maxAutoLayoutPanels) {
    say(i18n.t("layout.needPanels"));
    return;
  }
  if (state.draft) {
    patch({ dialog: "recovery" });
    return;
  }
  patch({ layoutState: "loading", layoutMessage: i18n.t("layout.loading"), liveMessage: i18n.t("layout.loading") });
  try {
    const result = await api.layoutCandidates(
      state.projectId,
      { baseRevision: state.confirmed.revision, request: { family: "auto" }, maxCandidates: 3 },
      newKey(),
    );
    revokePreviews(useWorkspace.getState().cards.map((card) => card.previewUrl));
    const cards = result.candidates.map((candidate) => ({ candidate, previewUrl: null, previewError: null }));
    patch({
      cards,
      activeCandidateId: cards[0]?.candidate.id ?? null,
      layoutState: "idle",
      layoutMessage: null,
      aiStatus: { phase: "idle" },
      liveMessage: i18n.t("layout.preview"),
    });
    void loadPreviews(state.projectId, cards.map((card) => card.candidate.id));
  } catch (error) {
    const conflict = error instanceof ApiClientError && error.code === "LAYOUT_CONFLICT";
    patch({
      cards: [],
      activeCandidateId: null,
      layoutState: conflict ? "conflict" : "error",
      layoutMessage: errorText(error),
      liveMessage: errorText(error),
    });
  }
}

async function loadPreviews(projectId: string, ids: string[]): Promise<void> {
  await Promise.all(ids.map(async (candidateId) => {
    try {
      const accepted = await api.preview(projectId, { source: { candidateId }, pixelWidth: 480 }, newKey());
      const job = await waitForJob(accepted.jobId);
      if (job.status !== "succeeded" || !job.result || !("artifactId" in job.result)) {
        markPreview(candidateId, null, i18n.t("layout.previewFailed"));
        return;
      }
      const file = await api.download(`/artifacts/${job.result.artifactId}/download`);
      markPreview(candidateId, URL.createObjectURL(file.blob), null);
    } catch (error) {
      markPreview(candidateId, null, errorText(error));
    }
  }));
}

function markPreview(candidateId: string, previewUrl: string | null, previewError: string | null): void {
  patch({
    cards: useWorkspace.getState().cards.map((card) =>
      card.candidate.id === candidateId ? { ...card, previewUrl, previewError } : card,
    ),
  });
}

function revokePreviews(urls: Array<string | null>): void {
  for (const url of urls) if (url) URL.revokeObjectURL(url);
}

export function selectCandidate(candidateId: string): void {
  if (candidatesBlocked()) return;
  patch({ activeCandidateId: candidateId });
}

export function continueEditing(): void {
  patch({ activeCandidateId: null });
}

export function dismissCandidates(): void {
  revokePreviews(useWorkspace.getState().cards.map((card) => card.previewUrl));
  const ai = useWorkspace.getState().cards.some((card) => card.candidate.origin === "ai");
  patch({
    cards: [],
    activeCandidateId: null,
    layoutState: "idle",
    layoutMessage: null,
    aiStatus: { phase: "idle" },
    liveMessage: i18n.t(ai ? "ai.discarded" : "layout.cancel"),
  });
}

function candidatesBlocked(): boolean {
  const state = useWorkspace.getState();
  return state.cards.length > 0 && (state.confirmed?.revision !== state.cards[0]?.candidate.baseRevision || state.draft !== null);
}

export function acceptCandidate(): Promise<void> {
  return later(async () => {
    const state = useWorkspace.getState();
    const card = state.cards.find((item) => item.candidate.id === state.activeCandidateId);
    if (!state.projectId || !state.confirmed || !card) {
      say(i18n.t("layout.pick"));
      return;
    }
    if (candidatesBlocked()) {
      patch({ activeCandidateId: null, liveMessage: i18n.t("layout.stale") });
      return;
    }
    patch({ saveState: "saving" });
    try {
      const result = await api.transaction(
        state.projectId,
        { baseRevision: state.confirmed.revision, candidateId: card.candidate.id },
        newKey(),
      );
      revokePreviews(state.cards.map((item) => item.previewUrl));
      patch({
        confirmed: {
          revision: result.revision,
          document: result.document,
          documentHash: result.documentHash,
          history: result.history,
        },
        cards: [],
        activeCandidateId: null,
        saveState: "saved",
        aiStatus: { phase: "idle" },
        liveMessage: i18n.t(card.candidate.origin === "ai" ? "ai.applied" : "layout.apply"),
      });
    } catch (error) {
      if (error instanceof ApiClientError && (error.code === "CANDIDATE_STALE" || error.code === "REVISION_CONFLICT")) {
        patch({ activeCandidateId: null, saveState: "saved", liveMessage: i18n.t("layout.stale") });
        return;
      }
      patch({ saveState: "saved", liveMessage: errorText(error) });
    }
  });
}

export async function exportFigure(request: ExportRequest): Promise<void> {
  const state = useWorkspace.getState();
  if (!state.projectId || !state.confirmed) return;
  patch({ exportState: { status: "running", revision: request.revision, phase: "export" }, dialog: "export" });
  try {
    const accepted = await api.exportFigure(state.projectId, request, newKey());
    const job = await waitForJob(accepted.jobId);
    patch({ exportState: { status: "running", revision: request.revision, phase: job.phase } });
    if (job.status !== "succeeded" || !job.result || !("artifactId" in job.result)) {
      patch({
        exportState: {
          status: "failed",
          message: job.status === "failed" ? job.error.message : i18n.t("errors.generic"),
        },
      });
      return;
    }
    const file = await api.download(`/artifacts/${job.result.artifactId}/download`);
    clickDownload(file.blob, file.filename);
    const diagnostics = "diagnostics" in job.result ? job.result.diagnostics : [];
    patch({
      exportState: {
        status: "ready",
        revision: request.revision,
        artifactId: job.result.artifactId,
        filename: file.filename,
        diagnostics,
        format: request.format,
      },
      liveMessage: i18n.t("export.downloadAgain"),
    });
  } catch (error) {
    patch({ exportState: { status: "failed", message: errorText(error) } });
  }
}

export async function downloadAgain(): Promise<void> {
  const current = useWorkspace.getState().exportState;
  if (!current || current.status !== "ready") return;
  const file = await api.download(`/artifacts/${current.artifactId}/download`);
  clickDownload(file.blob, current.filename || file.filename);
}

export async function downloadOriginal(assetId: string): Promise<void> {
  const { projectId } = useWorkspace.getState();
  if (!projectId) return;
  const file = await api.download(`/projects/${projectId}/assets/${assetId}/original`);
  clickDownload(file.blob, file.filename);
}

function clickDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function removeAsset(assetId: string): Promise<void> {
  const { projectId } = useWorkspace.getState();
  if (!projectId) return;
  try {
    await api.removeAsset(projectId, assetId);
    await queryClient.refetchQueries({ queryKey: ["assets", projectId] });
    say(i18n.t("assets.remove"));
  } catch (error) {
    say(errorText(error));
  }
}

export async function importPackage(file: File): Promise<void> {
  try {
    const accepted = await api.importPackage(file, newKey());
    const job = await waitForJob(accepted.jobId);
    if (job.status !== "succeeded" || !job.result || !("projectId" in job.result)) {
      say(job.status === "failed" ? job.error.message : i18n.t("errors.generic"));
      return;
    }
    await loadProject(job.result.projectId);
  } catch (error) {
    say(errorText(error));
  }
}

export function align(edge: "left" | "right" | "top" | "bottom" | "centerX" | "centerY", reference: "selection" | "canvas"): Promise<void> {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document) return Promise.resolve();
  const ids = panelIdsOf(state.selection, document);
  return transact([alignSelection(document, ids, edge, { kind: reference })]);
}

export function distribute(axis: "horizontal" | "vertical"): Promise<void> {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document) return Promise.resolve();
  return transact([distributeSelection(document, panelIdsOf(state.selection, document), axis)]);
}

export function equalSize(axis: "width" | "height"): Promise<void> {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document) return Promise.resolve();
  return transact([equalSizeSelection(document, panelIdsOf(state.selection, document), axis)]);
}

export function moveStack(panelId: string, move: StackMove): Promise<void> {
  const document = baseDocument(useWorkspace.getState());
  if (!document) return Promise.resolve();
  return transact([stackOrderCommand(document, panelId, move)]);
}

export function reorderLabels(panelOrder: string[]): Promise<void> {
  return transact([{ type: "panel.reorderLabels", panelOrder, resetTextOverrides: false }]);
}

export function createGroup(): Promise<void> {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document || state.selection.kind !== "panels" || state.selection.ids.length < 2) return Promise.resolve();
  const groupId = newKey();
  const name = state.locale === "zh-CN" ? `组 ${Object.keys(document.groups).length + 1}` : `Group ${Object.keys(document.groups).length + 1}`;
  patch({ selection: { kind: "group", groupId } });
  return transact([{ type: "group.create", groupId, name, panelIds: state.selection.ids }]);
}

export function dissolveGroup(groupId: string): Promise<void> {
  patch({ selection: { kind: "none" } });
  return transact([{ type: "group.remove", groupId }]);
}

export function deleteSelection(): Promise<void> {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document) return Promise.resolve();
  if (state.selection.kind === "label") {
    const panel = document.panels[state.selection.panelId];
    if (!panel) return Promise.resolve();
    return transact([
      {
        type: "label.setOverrides",
        items: [{ panelId: state.selection.panelId, value: mergedOverrides(panel.labelOverrides, { visible: false }) }],
      },
    ]);
  }
  const ids = panelIdsOf(state.selection, document);
  if (ids.length === 0) return Promise.resolve();
  patch({ selection: { kind: "none" } });
  return transact([{ type: "panel.remove", panelIds: ids }]);
}

export function enterCrop(panelId: string): void {
  const document = baseDocument(useWorkspace.getState());
  const panel = document?.panels[panelId];
  if (!document || !panel) return;
  const blocked = geometryLocked(document, panelId);
  if (blocked) {
    say(i18n.t(blocked === "group" ? "inspector.disabledGroup" : "inspector.disabledLock"));
    return;
  }
  patch({
    crop: { panelId, crop: { ...panel.cropNormalized } },
    activeCandidateId: null,
    selection: { kind: "panels", ids: [panelId] },
  });
}

export function cancelCrop(): void {
  patch({ crop: null });
}

export function restoreFullCrop(): void {
  const crop = useWorkspace.getState().crop;
  if (!crop) return;
  patch({ crop: { panelId: crop.panelId, crop: { x: 0, y: 0, width: 1, height: 1 } } });
}

export function updateCrop(crop: { x: number; y: number; width: number; height: number }): void {
  const current = useWorkspace.getState().crop;
  if (!current) return;
  patch({ crop: { panelId: current.panelId, crop } });
}

export function commitCrop(): Promise<void> {
  const crop = useWorkspace.getState().crop;
  if (!crop) return Promise.resolve();
  if (cropInvalid(crop.crop)) {
    say(i18n.t("crop.invalid"));
    return Promise.resolve();
  }
  return transact([{ type: "panel.setCrop", panelId: crop.panelId, cropNormalized: crop.crop }]);
}

export function selectAll(): void {
  const document = baseDocument(useWorkspace.getState());
  if (!document || document.panelOrder.length === 0) return;
  patch({ selection: { kind: "panels", ids: [...document.panelOrder] }, activeCandidateId: null });
}

export function assetThumbnail(projectId: string, asset: Asset): string | null {
  if (asset.status !== "ready" || asset.removedFromLibraryAt) return null;
  return thumbnailUrl(projectId, asset.id);
}

export function activeGroupId(document: FigureDocumentV1, panelId: string): string | null {
  return groupForPanel(document, panelId)?.id ?? null;
}

export function sendAiPrompt(
  prompt: string,
  options: { includePreviewImage: boolean; visualReview: boolean },
): Promise<void> {
  if (isUndoPrompt(prompt)) return undo();
  return later(() => sendAiNow(prompt, options));
}

export function cancelAiPrompt(): Promise<void> {
  const status = useWorkspace.getState().aiStatus;
  if (status.phase !== "running" || !status.jobId) return Promise.resolve();
  return api.cancelJob(status.jobId, newKey()).then(
    (job) => {
      if (job.status === "cancelled") {
        patch({ aiStatus: { phase: "cancelled" }, liveMessage: i18n.t("ai.cancelled") });
      }
    },
    (error: unknown) => patch({ liveMessage: errorText(error) }),
  );
}

async function sendAiNow(
  prompt: string,
  options: { includePreviewImage: boolean; visualReview: boolean },
): Promise<void> {
  const state = useWorkspace.getState();
  const document = state.confirmed?.document;
  if (!state.projectId || !state.confirmed || !document) return;
  if (state.draft) {
    patch({ dialog: "recovery" });
    return;
  }
  const text = prompt.trim();
  if (!text) return;
  let settings: Awaited<ReturnType<typeof api.providerSettings>>;
  try {
    settings = await api.providerSettings();
  } catch (error) {
    patch({ aiStatus: { phase: "failed", code: "NETWORK", message: errorText(error) }, liveMessage: errorText(error) });
    return;
  }
  if (!settings.config || !settings.hasSecret) {
    patch({ aiStatus: { phase: "failed", code: "PROVIDER_NOT_CONFIGURED", message: i18n.t("ai.notConfigured") }, liveMessage: i18n.t("ai.notConfigured") });
    return;
  }
  patch({ aiStatus: { phase: "running", jobId: "", label: i18n.t("ai.running") }, liveMessage: i18n.t("ai.running") });
  try {
    const accepted = await api.aiLayout(
      state.projectId,
      {
        baseRevision: state.confirmed.revision,
        prompt: text,
        selectedPanelIds: selectedIds(state.selection, document),
        replyLocale: state.locale,
        includePreviewImage: options.includePreviewImage && settings.config.capabilities.imageInput,
        visualReview: options.visualReview && settings.config.capabilities.imageInput,
      },
      newKey(),
    );
    patch({ aiStatus: { phase: "running", jobId: accepted.jobId, label: i18n.t("ai.running") } });
    const job = await waitForJob(accepted.jobId);
    if (useWorkspace.getState().aiStatus.phase === "cancelled") return;
    if (job.status === "cancelled") {
      patch({ aiStatus: { phase: "cancelled" }, liveMessage: i18n.t("ai.cancelled") });
      return;
    }
    if (job.status === "failed") {
      const code = job.error?.code ?? "REQUEST_INVALID";
      const message = aiFailureMessage(code, job.error?.message ?? "");
      patch({ aiStatus: { phase: "failed", code, message }, liveMessage: message });
      return;
    }
    const result = job.status === "succeeded" ? job.result : null;
    if (!result || !("kind" in result)) {
      patch({ aiStatus: { phase: "failed", code: "REQUEST_INVALID", message: i18n.t("ai.jobFailed") }, liveMessage: i18n.t("ai.jobFailed") });
      return;
    }
    if (result.kind === "clarification") {
      patch({
        aiStatus: { phase: "clarification", question: result.question, options: result.options ?? [] },
        liveMessage: result.question,
      });
      return;
    }
    if (result.kind === "unsupported") {
      patch({ aiStatus: { phase: "unsupported", reason: result.reason }, liveMessage: result.reason });
      return;
    }
    revokePreviews(useWorkspace.getState().cards.map((card) => card.previewUrl));
    const cards = result.candidates.map((candidate) => ({ candidate, previewUrl: null as string | null, previewError: null as string | null }));
    const stale = cards[0] && cards[0].candidate.baseRevision !== useWorkspace.getState().confirmed?.revision;
    patch({
      cards,
      activeCandidateId: stale ? null : cards[0]?.candidate.id ?? null,
      aiStatus: { phase: "idle" },
      layoutState: "idle",
      layoutMessage: null,
      liveMessage: stale ? i18n.t("ai.stale") : i18n.t("ai.ready"),
    });
    if (state.projectId) void loadPreviews(state.projectId, cards.map((card) => card.candidate.id));
  } catch (error) {
    const message = errorText(error);
    patch({ aiStatus: { phase: "failed", code: error instanceof ApiClientError ? error.code : "NETWORK", message }, liveMessage: message });
  }
}

function selectedIds(selection: ReturnType<typeof useWorkspace.getState>["selection"], document: FigureDocumentV1): string[] {
  if (selection.kind === "panels") return selection.ids.filter((id) => document.panels[id]);
  if (selection.kind === "group") return document.groups[selection.groupId]?.panelIds ?? [];
  if (selection.kind === "label") return document.panels[selection.panelId] ? [selection.panelId] : [];
  return [];
}

function isUndoPrompt(prompt: string): boolean {
  const text = prompt.trim().toLowerCase();
  return text === "撤销" || text === "撤消" || text === "undo";
}

function aiFailureMessage(code: string, message: string): string {
  if (code === "PROVIDER_NOT_CONFIGURED") return i18n.t("ai.notConfigured");
  if (code === "MODEL_OUTPUT_INVALID") return i18n.t("ai.invalidOutput");
  if (code === "PROVIDER_CONFIG_CHANGED") return i18n.t("ai.configChanged");
  if (code === "LAYOUT_CONFLICT" || code === "LOCKED_ELEMENT" || code === "GROUP_PARTIAL_EDIT" || code === "OUTSIDE_CANVAS") {
    const key = `errors.${code}`;
    const translated = i18n.t(key);
    return translated === key ? message : translated;
  }
  return message || i18n.t("ai.jobFailed");
}

export { candidatesBlocked as layoutIsStale };
