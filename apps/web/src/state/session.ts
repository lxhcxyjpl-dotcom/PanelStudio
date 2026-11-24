import {
  RESOURCE_LIMITS,
  type Asset,
  type Candidate,
  type Diagnostic,
  type DomainCommand,
  type ExportRequest,
  type FigureDocumentV1,
  type LayoutRequest,
} from "@panelstudio/contracts";
import { applyCommands, type AssetLookup } from "@panelstudio/core/apply";
import {
  alignSelection,
  distributeSelection,
  equalSizeSelection,
  translateSelection,
} from "@panelstudio/core/arrange";
import { stackOrderCommand, type StackMove } from "@panelstudio/core/stack";
import { api, ApiClientError, newKey, thumbnailUrl, waitForJob, type AssetPage } from "../api/client";
import { i18n } from "../i18n";
import { proposalChanges } from "../model/changes";
import { cropInvalid, geometryLocked, groupForPanel, mergedOverrides, panelIdsOf } from "../model/document-ui";
import { placePanelCommands } from "../model/place";
import { writeProjectId } from "../prefs";
import { clearRecovery, readRecovery, writeRecovery, type RecoveryDraft } from "./drafts";
import { queryClient } from "./query";
import { patch, syncChrome, useWorkspace } from "./store";
import { changeWish, isCurrentWishEdit, openWish, useWish, type WishEditFeedback } from "./wish-session";
import { asksForSelection } from "../model/wish";
import { errorText } from "../model/feedback";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { belongsToProject, dismissCandidates, generateAi, generateLayout, projectEpoch, refreshAiHistory, resetCandidateSession } from "./candidate-session";
import { baseDocument, candidatesStale, type Confirmed, type ImportRow, type PendingDraft } from "./types";
import { adoptProjectPath, commitPath, navigate, projectPath, useNavigation } from "../navigation";
import { cancelGesture } from "../ui/gesture";

import rasterUrl from "../../../../fixtures/mixed/raster.png";
import photoUrl from "../../../../fixtures/mixed/photo.jpg";
import vectorUrl from "../../../../fixtures/mixed/panel-vector.svg";

let chain: Promise<void> = Promise.resolve();
const activeImports = new Set<Promise<unknown>>();
let bootPromise: Promise<void> | null = null;
let loadingProject = 0;
let creatingProject: Promise<string | null> | null = null;
let nudgeTimer = 0;
let nudge: { ids: string[]; dx: number; dy: number; kind: "panels" | "label"; projectId: string; epoch: number } | null = null;

function later(task: () => Promise<void>): Promise<void> {
  const projectId = useWorkspace.getState().projectId;
  const epoch = projectEpoch();
  const guarded = () => belongsToProject(projectId, epoch) ? task() : Promise.resolve();
  const run = chain.then(guarded, guarded);
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

export function boot(): Promise<void> {
  return bootPromise ??= initializeSession();
}

async function initializeSession(): Promise<void> {
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
  patch({ booting: false });
}

export async function loadProject(projectId: string, isCurrent: () => boolean = () => true): Promise<void> {
  const ticket = ++loadingProject;
  const [project, document, assets] = await Promise.all([api.project(projectId), api.document(projectId), api.assets(projectId)]);
  if (ticket !== loadingProject || !isCurrent()) return;
  if (project.deletedAt) throw new Error(i18n.t("route.deleted"));
  cancelNudge();
  const epoch = resetCandidateSession(projectId);
  queryClient.setQueryData(["assets", projectId], assets);
  writeProjectId(projectId);
  openWish(projectId, document.document.panelOrder.length > 0);
  const confirmed: Confirmed = {
    revision: document.revision,
    document: document.document,
    documentHash: document.documentHash,
    history: document.history,
  };
  patch({
    startMessage: "",
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
  void refreshAiHistory(true);
  const saved = await readRecovery(projectId).catch(() => null);
  if (!belongsToProject(projectId, epoch) || !saved || saved.pendingCommands.length === 0) return;
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

/** Settle edits before leaving; keep the original session if recovery is needed. */
export async function prepareNavigation(): Promise<boolean> {
  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cancelGesture();
  if (useWorkspace.getState().crop) {
    useNavigation.setState({ notice: i18n.t("route.finishCrop") });
    return false;
  }
  while (activeImports.size) await Promise.allSettled([...activeImports]);
  const epoch = projectEpoch();
  if (nudge) await flushNudge();
  await chain;
  if (epoch !== projectEpoch()) return false;
  const state = useWorkspace.getState();
  if (state.draft) {
    await remember(state.draft, state.projectId);
    patch({ dialog: "recovery", liveMessage: i18n.t("save.failed") });
    return false;
  }
  return true;
}

export function hasUnsettledEdits(): boolean {
  const state = useWorkspace.getState();
  return activeImports.size > 0 || Boolean(nudge || state.draft || state.optimistic || state.interaction || state.crop) || state.saveState === "saving";
}

export function newProject(askForContext = false): Promise<string | null> {
  if (creatingProject) return creatingProject;
  creatingProject = (async () => {
    if (!await prepareNavigation()) return null;
    const title = i18n.t("project.untitled");
    const created = await api.createProject(title, newKey());
    await loadProject(created.project.id);
    patch({ imports: [], startMessage: "", ...(askForContext ? { dialog: "publication" as const } : {}) });
    adoptProjectPath(created.project.id);
    return created.project.id;
  })().finally(() => { creatingProject = null; });
  return creatingProject;
}

let openingEmpty: Promise<string> | null = null;
export async function ensureProject(askForContext = true): Promise<string> {
  const existing = useWorkspace.getState();
  if (existing.projectId && existing.confirmed) return existing.projectId;
  if (!openingEmpty) openingEmpty = createEmptyProject(askForContext).finally(() => { openingEmpty = null; });
  return openingEmpty;
}
async function createEmptyProject(askForContext: boolean): Promise<string> {
  const current = useWorkspace.getState();
  if (current.projectId && current.confirmed) return current.projectId;
  const title = current.locale === "zh-CN" ? "未命名图稿" : "Untitled figure";
  const created = await api.createProject(title, newKey());
  const fresh = await api.document(created.project.id);
  resetCandidateSession(created.project.id);
  writeProjectId(created.project.id);
  openWish(created.project.id);
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
    ...(askForContext ? { dialog: "publication" as const } : {}),
  });
  adoptProjectPath(created.project.id, true);
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
  return navigate(projectPath(projectId)).then(opened => {
    if (opened && useWorkspace.getState().dialog === "projects") patch({ dialog: null });
  });
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
  if (useWorkspace.getState().projectId !== projectId) return;
  showStart(i18n.t("toolbar.projectDeleted"));
  commitPath("/app", "replace");
}

export async function returnToStart(): Promise<void> {
  await navigate("/");
}

function showStart(message: string): void {
  resetCandidateSession(null);
  writeProjectId(null);
  openWish(null);
  patch({
    startMessage: "",
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
    leftOpen: false,
    rightOpen: false,
    liveMessage: message,
  });
}

export async function restoreListedProject(projectId: string): Promise<void> {
  const state = useWorkspace.getState();
  if (state.draft && state.projectId && state.projectId !== projectId) {
    patch({ dialog: "recovery", liveMessage: i18n.t("save.conflict") });
    return;
  }
  await api.restoreProject(projectId, newKey());
  await openListedProject(projectId);
  patch({ liveMessage: i18n.t("toolbar.projectRestored") });
}

export function renameTitle(title: string, expectedTitle?: string): Promise<void> {
  return later(async () => {
    const state = useWorkspace.getState();
    const { projectId } = state;
    if (!projectId || (expectedTitle !== undefined && state.title !== expectedTitle)) return;
    const project = await api.renameProject(projectId, title);
    if (useWorkspace.getState().projectId === projectId) patch({ title: project.title, liveMessage: i18n.t("save.saved") });
  });
}

function importBatch(files: File[], libraryOnly: boolean): Promise<string[]> {
  const pending = importAndPlace(files, libraryOnly);
  activeImports.add(pending);
  return pending.finally(() => activeImports.delete(pending));
}
export function importFiles(files: File[], libraryOnly = false): Promise<void> {
  return importBatch(files, libraryOnly).then(() => undefined);
}
export function importToLibrary(file: File): Promise<string | undefined> {
  return importBatch([file], true).then(ids => ids[0]);
}

async function importAndPlace(files: File[], libraryOnly: boolean): Promise<string[]> {
  if (files.length === 0) return [];
  const projectId = await ensureProject(false);
  const epoch = projectEpoch();
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
  if (!belongsToProject(projectId, epoch)) return [];
  const library = await api.assets(projectId);
  if (!belongsToProject(projectId, epoch)) return [];
  queryClient.setQueryData(["assets", projectId], library);
  if (failed > 0) say(i18n.t("assets.partial"));
  const wish = useWish.getState();
  const priorOrder = wish.order;
  changeWish({ order: [...new Set([...priorOrder, ...ready])] });
  if (failed) {
    patch({assetTab:"assets", leftOpen:true});
    changeWish({reply:i18n.t("assets.partial")});
  }
  if (!ready.length || libraryOnly) return ready;
  const state = useWorkspace.getState();
  const count = state.confirmed?.document.panelOrder.length ?? 0;
  const initial = !count && !state.cards.length;
  if (wish.phase === "select" || ready.length + count > RESOURCE_LIMITS.maxPanelsPerProject || (initial && asksForSelection(wish.input))) {
    const selected = wish.phase === "select" ? wish.selected : Object.values(state.confirmed?.document.panels ?? {}).map(panel=>panel.assetId);
    changeWish({phase:"select", selected:[...new Set(selected)]});
  } else {
    await offerAssets(ready);
  }
  return ready;
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
  if (useWorkspace.getState().confirmed && !await newProject(false)) return;
  patch({ startMessage: "" });
  await ensureProject(false);
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

function recordWishEdit(before: Confirmed, projectId: string, focusPanelId?: string): void {
  const after = useWorkspace.getState().confirmed;
  const wish = useWish.getState();
  if (!after || wish.projectId !== projectId || wish.phase !== "editing" || !before.document.panelOrder.length) return;
  const changed = before.documentHash !== after.documentHash;
  changeWish({ editFeedback: {
    revision: after.revision,
    documentHash: after.documentHash,
    changed,
    changes: changed ? proposalChanges(before.document, after.document) : [],
    ...(focusPanelId ? { focusPanelId } : {}),
  } });
}

/** Serialize the preview and commit against the revision from which the author made the wish. */
export function commitWish(revision: number, commands: DomainCommand[], request?: LayoutRequest, focusPanelId?: string): Promise<void> {
  let committed = false;
  const epoch = projectEpoch();
  return later(async () => {
    const state = useWorkspace.getState();
    if (!state.projectId || state.confirmed?.revision !== revision || state.draft || state.crop || state.optimistic)
      throw new Error(i18n.t("wish.changed"));
    let candidate: Candidate | undefined;
    if (request) {
      const preparation = commands.filter((c): c is Extract<DomainCommand,{type:"panel.add"|"panel.remove"|"panel.replaceAsset"|"figure.setPublicationContext"|"figure.setCuration"}> =>
        c.type === "panel.add" || c.type === "panel.remove" || c.type === "panel.replaceAsset" ||
        c.type === "figure.setPublicationContext" || c.type === "figure.setCuration");
      if (preparation.length !== commands.length) throw new Error(i18n.t("wish.changed"));
      const response = await api.layoutCandidates(state.projectId, {baseRevision:revision, request, maxCandidates:1, preparation}, newKey());
      candidate = response.candidates[0];
      if (!candidate) throw new Error(i18n.t("layout.pick"));
    }
    if (!belongsToProject(state.projectId, epoch) || useWorkspace.getState().confirmed?.revision !== revision)
      throw new Error(i18n.t("wish.changed"));
    if (candidate) {
      await saveCandidate(candidate);
    } else if (commands.length) {
      let rejection: unknown;
      await transactNow(commands, error => { rejection = error; });
      if (rejection) throw rejection;
      const saved = useWorkspace.getState();
      if (saved.confirmed?.revision !== revision + 1 || saved.saveState !== "saved") throw new Error(i18n.t("save.failed"));
    }
    if (!belongsToProject(state.projectId, epoch)) return;
    const publicationOnly = !request && commands.length === 1 && commands[0]?.type === "figure.setPublicationContext";
    if (!publicationOnly) recordWishEdit(state.confirmed, state.projectId, focusPanelId);
    if (useWorkspace.getState().cards.length) dismissCandidates();
    committed = true;
  }).then(() => { if (!committed) throw new Error(i18n.t("wish.changed")); });
}

export function resizeCanvas(
  dimension: "widthMm" | "heightMm", value: number,
  onRejected: (error: unknown, source: FigureDocumentV1) => void,
): Promise<void> {
  return later(async () => {
    const document = useWorkspace.getState().confirmed?.document;
    if (!document || document.canvas[dimension] === value) return;
    await transactNow(
      [{ type: "canvas.set", canvas: { ...document.canvas, [dimension]: value } }],
      error => onRejected(error, document),
    );
  });
}

async function transactNow(commands: DomainCommand[], onRejected?: (error: unknown) => void): Promise<void> {
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
    onRejected?.(error);
    return;
  }
  const idempotencyKey = newKey();
  const epoch = projectEpoch();
  patch({ saveState: "saving", optimistic: next, interaction: null, crop: null, compareMode: "editing" });
  try {
    const result = await api.transaction(state.projectId, { baseRevision: state.confirmed.revision, commands }, idempotencyKey);
    if (!belongsToProject(state.projectId, epoch)) return;
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
    if (!belongsToProject(state.projectId, epoch)) return;
    onRejected?.(error);
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

export function undoWishEdit(projectId: string, edit: WishEditFeedback): Promise<void> {
  return history("undo", { projectId, edit });
}

export function redo(): Promise<void> {
  return history("redo");
}

function history(direction: "undo" | "redo", target?: { projectId: string; edit: WishEditFeedback }): Promise<void> {
  return later(async () => {
    const state = useWorkspace.getState();
    if (target && (!target.edit.changed || target.projectId !== state.projectId || !isCurrentWishEdit(target.edit, state.confirmed) ||
        state.saveState !== "saved" || state.crop || state.interaction || nudge)) return;
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
    await runHistory(direction, state.confirmed.revision, newKey(), Boolean(target));
  });
}

async function runHistory(direction: "undo" | "redo", baseRevision: number, key: string, fromWish = false): Promise<void> {
  const { projectId, confirmed } = useWorkspace.getState();
  const priorCuration = confirmed?.document.curation;
  if (!projectId) return;
  const epoch = projectEpoch();
  patch({ saveState: "saving", historyRetry: null });
  try {
    const result = direction === "undo" ? await api.undo(projectId, baseRevision, key) : await api.redo(projectId, baseRevision, key);
    if (!belongsToProject(projectId, epoch)) return;
    patch({
      confirmed: {
        revision: result.revision,
        document: result.document,
        documentHash: result.documentHash,
        history: result.history,
      },
      optimistic: null,
      saveState: "saved",
      compareMode: "editing",
      historyRetry: null,
      liveMessage: i18n.t(direction === "undo" ? "history.undone" : "history.redone"),
    });
    const wish = useWish.getState();
    if ((wish.selected.length || priorCuration) && result.document.panelOrder.length === 0 && direction === "undo") {
      const selected = wish.selected.length ? wish.selected : priorCuration?.main.map(pick=>pick.id) ?? [];
      changeWish({phase:"select",selected,reply:i18n.t("wish.revised",{count:selected.length}),editFeedback:null});
    } else if (wish.phase === "select" && direction === "redo" && result.document.panelOrder.length) {
      changeWish({phase:"editing",reply:"",editFeedback:null});
    } else if (fromWish || result.document.curation || wish.editFeedback) {
      changeWish({reply:i18n.t(direction === "undo" ? "history.undone" : "history.redone"),replyRevision:result.revision,editFeedback:null});
    }
  } catch (error) {
    if (!belongsToProject(projectId, epoch)) return;
    if (fromWish && error instanceof ApiClientError && error.code === "REVISION_CONFLICT") {
      changeWish({ editFeedback: null, reply: i18n.t("wish.changed") });
      patch({ saveState: "saved", liveMessage: i18n.t("wish.changed") });
      await loadProject(projectId, () => belongsToProject(projectId, epoch)).catch(() => {});
      return;
    }
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

export function labelMove(document: FigureDocumentV1, panelId: string, dx: number, dy: number): DomainCommand {
  const panel = document.panels[panelId];
  const label = resolvePanelLabel(document, panelId);
  if (!panel || !label) throw new Error(i18n.t("panels.empty"));
  return {
    type: "label.setOverrides", items: [{ panelId, value: { ...panel.labelOverrides,
      offsetMm: { x: label.x - panel.frameMm.x + dx, y: label.y - panel.frameMm.y + dy },
    } }],
  };
}

function nudgeCommand(document: FigureDocumentV1, step: NonNullable<typeof nudge>) {
  return step.kind === "label" ? labelMove(document, step.ids[0]!, step.dx, step.dy) : translateSelection(document, step.ids, step.dx, step.dy);
}

export function cancelNudge() {
  window.clearTimeout(nudgeTimer);
  nudge = null;
  patch({ interaction: null });
}

export function queueNudge(ids: string[], dx: number, dy: number, kind: "panels" | "label" = "panels"): void {
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  if (!document || !state.projectId || state.draft || ids.length === 0) return;
  if (nudge && (nudge.kind !== kind || nudge.ids.join() !== ids.join())) void flushNudge();
  if (!nudge) nudge = { ids, kind, projectId: state.projectId, epoch: projectEpoch(), dx: 0, dy: 0 };
  nudge.dx += dx;
  nudge.dy += dy;
  try {
    const command = nudgeCommand(document, nudge);
    const preview = applyCommands(document, [command], lookupFor(state.projectId));
    patch({ interaction: preview, compareMode: "editing" });
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
  if (!document || !belongsToProject(current.projectId, current.epoch)) return;
  try { await transact([nudgeCommand(document, current)]); } catch (error) { say(errorText(error)); }
}

export async function requestLayout(request: LayoutRequest = { family: "auto" }) {
  patch({ inspectorMode: "layout", rightOpen: true });
  const epoch = projectEpoch();
  if (nudge) await flushNudge();
  await chain;
  if (projectEpoch() === epoch) return generateLayout(request);
}

async function saveCandidate(candidate: Candidate): Promise<void> {
  const project = candidate.projectId, epoch = projectEpoch();
  if (useWorkspace.getState().projectId !== project || useWorkspace.getState().confirmed?.revision !== candidate.baseRevision)
    throw new Error(i18n.t("wish.changed"));
  const key = newKey();
  const persist = () => api.transaction(project, {baseRevision:candidate.baseRevision, candidateId:candidate.id}, key);
  patch({saveState:"saving"});
  try {
    const result = await persist().catch(error => {
      // A lost response may already have committed. Replay the same request/key.
      if (error instanceof ApiClientError && error.status === 0 && belongsToProject(project,epoch)) return persist();
      throw error;
    });
    if (!belongsToProject(project,epoch)) return;
    dismissCandidates();
    patch({confirmed:{revision:result.revision,document:result.document,documentHash:result.documentHash,history:result.history},
      saveState:"saved",liveMessage:i18n.t(candidate.origin==="ai" ? "ai.applied":"layout.apply")});
  } catch(error) {
    if (!belongsToProject(project,epoch)) return;
    patch({saveState:"saved",liveMessage:errorText(error)});
    if (error instanceof ApiClientError && (error.code==="CANDIDATE_STALE" || error.code==="REVISION_CONFLICT"))
      await reloadFromServer();
    throw error;
  }
}

export function acceptCandidate(reportWishEdit = false): Promise<void> {
  return later(async () => {
    const state = useWorkspace.getState();
    const card = state.cards.find(item=>item.candidate.id===state.activeCandidateId);
    if (!card) return say(i18n.t("layout.pick"));
    if (candidatesStale(state)) return patch({compareMode:"editing",liveMessage:i18n.t("layout.stale")});
    const epoch = projectEpoch();
    try {
      await saveCandidate(card.candidate);
      if (reportWishEdit && state.confirmed && state.projectId && belongsToProject(state.projectId, epoch))
        recordWishEdit(state.confirmed, state.projectId);
    } catch (error) {
      if (reportWishEdit) throw error;
      // saveCandidate reports the error in the active workspace.
    }
  });
}

export async function exportFigure(request: ExportRequest, source: Confirmed): Promise<void> {
  const state = useWorkspace.getState();
  if (!state.projectId || !state.confirmed || state.exportState?.status === "running") return;
  const epoch = projectEpoch();
  patch({ exportState: { status: "running", request, source, phase: "export" }, dialog: "export" });
  try {
    const accepted = await api.exportFigure(state.projectId, request, newKey());
    const job = await waitForJob(accepted.jobId);
    if (!belongsToProject(state.projectId, epoch)) return;
    patch({ exportState: { status: "running", request, source, phase: job.phase } });
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
    if (!belongsToProject(state.projectId, epoch)) return;
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
    if (!belongsToProject(state.projectId, epoch)) return;
    patch({ exportState: { status: "failed", message: errorText(error) } });
  }
}

export async function downloadAgain(): Promise<void> {
  const current = useWorkspace.getState().exportState;
  if (!current || current.status !== "ready") return;
  try {
    const file = await api.download(`/artifacts/${current.artifactId}/download`);
    if (useWorkspace.getState().exportState === current) clickDownload(file.blob, current.filename || file.filename);
  } catch (error) {
    if (useWorkspace.getState().exportState === current) patch({ exportState: { status: "failed", message: errorText(error) } });
  }
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
  if (!await prepareNavigation()) return;
  const pending = importPackageNow(file);
  activeImports.add(pending);
  return pending.finally(() => activeImports.delete(pending));
}

async function importPackageNow(file: File): Promise<void> {
  try {
    const accepted = await api.importPackage(file, newKey());
    const job = await waitForJob(accepted.jobId);
    if (job.status !== "succeeded" || !job.result || !("projectId" in job.result)) {
      const message = job.status === "failed" ? job.error.message : i18n.t("errors.generic");
      say(message);
      useNavigation.setState({ notice: message });
      return;
    }
    await loadProject(job.result.projectId);
    adoptProjectPath(job.result.projectId);
  } catch (error) {
    say(errorText(error));
    useNavigation.setState({ notice: errorText(error) });
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
    compareMode: "editing",
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
  patch({ selection: { kind: "panels", ids: [...document.panelOrder] } });
}

export function assetThumbnail(projectId: string, asset: Asset): string | null {
  if (asset.status !== "ready" || asset.removedFromLibraryAt) return null;
  return thumbnailUrl(projectId, asset.id);
}

export function activeGroupId(document: FigureDocumentV1, panelId: string): string | null {
  return groupForPanel(document, panelId)?.id ?? null;
}

export async function sendAiPrompt(prompt: string, options: Parameters<typeof generateAi>[1]) {
  patch({ inspectorMode: "ai", rightOpen: true });
  if (["撤销", "撤消", "undo"].includes(prompt.trim().toLowerCase())) return undo();
  const epoch = projectEpoch();
  if (nudge) await flushNudge();
  await chain;
  if (projectEpoch() === epoch) await generateAi(prompt, options);
}

export { cancelAiPrompt, continueEditing, dismissCandidates, selectCandidate } from "./candidate-session";
