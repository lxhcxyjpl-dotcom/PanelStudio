import {
  RESOURCE_LIMITS,
  figureKinds,
  type FigureReading,
  type FigureDiscussionReply,
  type ConfirmFigureIdentity,
  type Asset,
  type DomainCommand,
  type FigureCuration,
  type PublicationContext,
} from "@panelstudio/contracts";
import { applyCommands, DocumentCommandError } from "@panelstudio/core/apply";
import { cropsNearlyEqual, framesNearlyEqual } from "@panelstudio/core/geometry";
import { scalePanel, translateSelection } from "@panelstudio/core/arrange";
import { api, ApiClientError, newKey, type AssetPage } from "../api/client";
import { i18n } from "../i18n";
import {
  allImagesClause,
  asksForSelection,
  assetMentions,
  automatic,
  interpretWish,
  localPairRequest,
  figureWidth,
  narrativeFocus,
  publicationFrom,
  requestsCuration,
  shortlist,
  selectionLayoutPart,
  uncertainLayout,
  type WishInterpretation,
} from "../model/wish";
import { panelIdsOf } from "../model/document-ui";
import { labelName, proposalChanges } from "../model/changes";
import { curatedPanelRows, layoutNarrativeRows, narrativeRows } from "../model/narrative-layout";
import { placePanelCommands } from "../model/place";
import { errorText } from "../model/feedback";
import { belongsToProject, generateAi, projectEpoch } from "./candidate-session";
import { queryClient } from "./query";
import { cachedReadingProvider, preferredReadingMode } from "./reading-preference";
import {
  acceptCandidate,
  assetLookup,
  commitWish,
  ensureProject,
  importFiles,
  importToLibrary,
  newProject,
  renameTitle,
  undo,
} from "./session";
import { patch, useWorkspace } from "./store";
import {
  changeWish,
  beginCuration,
  lastPublication,
  rememberPublication,
  useWish,
  type IdentityQuestion,
  type CuratedSwap,
  type WishCheckpoint,
  type WishSession,
  seedWish,
} from "./wish-session";

import type { OpeningArchive } from "./opening";
import { firstVersion, type VersionRef } from "./message-versions";
const get = useWorkspace.getState;
const wish = useWish.getState;
const limit = RESOURCE_LIMITS.maxPanelsPerProject;
const t = (key: string, values?: Record<string, unknown>) => String(i18n.t(key, values ?? {}));
export function libraryForWish() {
  const page = queryClient.getQueryData<AssetPage>(["assets", get().projectId]);
  return orderAssets(page?.items ?? [], wish().order).map((a) => ({ ...a, ...wish().evidence[a.id] }));
}
export function orderAssets(items: Asset[], order: string[]) {
  const ranks = new Map(order.map((id, i) => [id, i]));
  return items
    .filter((a) => a.status === "ready" && !a.removedFromLibraryAt)
    .sort(
      (a, b) =>
        (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
export async function startWithWish(
  files: File[],
  words: string,
  fresh: boolean,
  model: WishModel = "local",
  opening?: { turns: string[]; select: boolean; curate?: boolean; layout: string; goal?: string; archive?: OpeningArchive; attachedTurn?: boolean; previousGoal?: string },
) {
  if (fresh && get().projectId) {
    if (!(await newProject(false))) return;
  } else await ensureProject(false);
  const id = get().projectId,
    epoch = projectEpoch();
  const beforeImport = get().confirmed;
  const planAllBeforePlacing = model === "thumbnails" && !words.trim() &&
    !beforeImport?.document.panelOrder.length && !opening?.select && !opening?.curate;
  const previousSelection = beforeImport ? panelIdsOf(get().selection,beforeImport.document) : [];
  changeWish({
    input: words,
    busy: true,
    ...(opening?.select || opening?.curate ? { phase: "select" as const } : {}),
    ...(opening?.curate ? { curation: beginCuration() } : {}),
    ...(opening?.goal ? { goal: opening.goal } : {}),
    ...(opening?.turns.length ? { turns: opening.turns } : {}),
    ...(opening?.layout ? { layout: opening.layout } : {}),
    ...(opening?.archive ? { opening:{...opening.archive, path:{...opening.archive.path,projectId:id!}} } : {}),
  });
  if (get().startMessage === words) patch({ startMessage: "" });
  try {
    if (files.length) await importFiles(files, planAllBeforePlacing);
  } finally {
    if (belongsToProject(id, epoch)) changeWish({ busy: false });
  }
  if (!belongsToProject(id, epoch) || !libraryForWish().length) return false;
  const figureNumber = /(?:\bfig(?:ure)?\.?\s+|图\s*)([1-9]\d{0,2})(?![\d\-A-Za-z]|\.\d)/iu.exec(words.normalize("NFKC"));
  const currentTitle = get().title;
  if (figureNumber && currentTitle === t("project.untitled")) {
    await renameTitle(t("wish.figureTitle", { number: figureNumber[1] }), currentTitle).catch(() => {});
    if (!belongsToProject(id, epoch)) return;
  }
  if (opening?.attachedTurn && opening.turns.length) {
    const point = checkpoint("say");
    if (point && beforeImport) {
      // The artwork belongs to this message. Its automatic placement belongs to the original answer.
      point.revision = beforeImport.revision;
      point.panelIds = previousSelection;
      point.fileTurn = true;
      point.before = { ...point.before, phase:"draft", layout:"", goal:opening.previousGoal ?? "", question:null, curation:null, reply:"" };
      changeWish({ checkpoints:{...wish().checkpoints,[opening.turns.length - 1]:point} });
    }
  }
  if (words.trim()) await submitWish(words, "say", model, !opening?.turns.length);
  else if (wish().phase === "draft")
    await submitWish("", "draft", model);
  if (opening?.layout && belongsToProject(id, epoch) && wish().phase === "select")
    changeWish({ layout: opening.layout });
  return true;
}
let activeDiscussion: { project: string; controller: AbortController } | undefined;
export function stopWishDiscussion() {
  if (activeDiscussion?.project === get().projectId) activeDiscussion?.controller.abort();
}
async function readForWish<T>(project: string, epoch: number, label: string, read: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  activeDiscussion = {project,controller};
  useWish.setState({canStopDiscussion:true,reply:label});
  try {
    const result = await read(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    if (belongsToProject(project,epoch)) changeWish({reply:t("chat.stopped")});
    return null;
  } finally {
    if (activeDiscussion?.controller === controller) activeDiscussion = undefined;
    if (belongsToProject(project,epoch)) useWish.setState({canStopDiscussion:false});
  }
}
export function openSelection() {
  const doc = get().confirmed?.document;
  const selected = doc?.panelOrder.map((id) => doc.panels[id]!.assetId) ?? [];
  changeWish({
    phase: "select",
    rows: [],
    reasons: {},
    selected: [...new Set(selected)],
    layoutRecovery: null,
    reply: selected.length ? "" : t("wish.localPick"),
    question: null,
  });
}
function reviewSelection(text: string, assets: ReturnType<typeof libraryForWish>) {
  const state = wish();
  const notes = { ...state.notes };
  for (const hit of text.matchAll(
    /(?:#|图\s*|素材\s*|第\s*)(\d+)\s*(?:是|为|[:：=]|is\s+)([^,，。；;\n]+)/gi,
  )) {
    const asset = assets[Number(hit[1]) - 1];
    if (asset) notes[asset.id] = hit[2]!.trim();
  }
  if (/为什么|为何|why\b/i.test(text)) {
    const ids = assetMentions(text, assets, notes);
    const choices = (ids.length ? ids : state.selected)
      .map((id) => assets.find((a) => a.id === id))
      .filter((a) => a !== undefined);
    const answer = choices
      .slice(0, 3)
      .map(
        (a) =>
          state.reasons[a.id] ||
          t(state.selected.includes(a.id) ? "wish.whyIn" : "wish.whyOut", {
            name: a.originalFilename,
            clue: notes[a.id] || a.originalFilename,
          }),
      )
      .join(" ");
    changeWish({ reply: answer || t("wish.identify") });
    return;
  }
  if (
    !state.goal &&
    asksForSelection(text) &&
    !/比较|定量|对照|重点|展示|compare|quant|show|include|保留/i.test(text)
  ) {
    changeWish({ reply: t("wish.localPick") });
    return;
  }
  const include = new Set<string>(),
    exclude = new Set<string>();
  let explicit = false;
  for (const part of text.split(/[,，。；;\n]|(?:但|但是|but )/i)) {
    const negative =
      /不[要用放选]|不要|不放|去掉|排除|去除|删掉|移除|换掉|留.*补充|exclude|leave out|drop|omit|remove/i.test(
        part,
      );
    const positive = /只[选用放留]|加上|加入|保留|选入|也放|添加|include|add |keep |only /i.test(part);
    if (!positive && !negative) continue;
    const ids = [
      ...new Set(
        part
          .split(/\s*(?:和|以及|与|、|\band\b)\s*/i)
          .flatMap((segment) => assetMentions(segment, assets, notes)),
      ),
    ];
    if (!ids.length) return changeWish({ notes, reply: t("wish.identify") });
    explicit = true;
    for (const id of ids) (negative ? exclude : include).add(id);
  }
  let picked: string[];
  let reasons = { ...state.reasons };
  if (explicit) {
    const only = /只[选用放留]|only /i.test(text);
    picked = [...new Set([...(only ? [] : state.selected), ...include])].filter((id) => !exclude.has(id));
  } else {
    const ranked = shortlist([state.goal, text].filter(Boolean).join(" "), assets, notes);
    picked = ranked.length ? ranked.map((a) => a.id) : state.selected;
    if (ranked.length)
      reasons = Object.fromEntries(
        ranked.map((a) => [a.id, t("wish.matches", { clues: [...new Set(a.hits)].slice(0, 4).join("、") })]),
      );
  }
  if (picked.length > limit) return changeWish({ notes, reply: t("wish.tooMany", { count: limit }) });
  const goal =
    explicit || (asksForSelection(text) && !/比较|对照|定量|展示|quant|compar/i.test(text))
      ? state.goal
      : [state.goal, text].filter(Boolean).join("；").slice(-1000);
  const filenames = picked.map((id) => assets.find((a) => a.id === id)?.originalFilename).filter(Boolean);
  const rationale =
    picked.length && !explicit ? " " + t("wish.evidence", { names: filenames.slice(0, 3).join("、") }) : "";
  changeWish({
    selected: picked,
    notes,
    goal,
    rows: [],
    reasons,
    layoutRecovery: null,
    reply: picked.length
      ? t(explicit ? "wish.revised" : "wish.suggested", { count: picked.length }) + rationale
        : t(asksForSelection(text) && !goal ? "wish.localPick" : "wish.identify"),
  });
}

async function makeDraft(
  words: string,
  selection?: string[],
  brief?: PublicationContext,
  directEdit?: Extract<WishInterpretation, { kind: "move" | "resize" }>,
  curation?: FigureCuration,
  primaryAsset?: string,
) {
  const state = get();
  if (!state.confirmed) throw new Error(t("wish.changed"));
  const document = state.confirmed.document;
  const assets = libraryForWish();
  const lookup = assetLookup();
  const commands: DomainCommand[] = [];
  if (brief) commands.push({ type: "figure.setPublicationContext", publicationContext: brief });
  if (curation) commands.push({ type:"figure.setCuration", curation });
  if (selection) {
    if (!selection.length || selection.length > limit)
      throw new Error(t("wish.chooseRange", { count: limit }));
    const selected = new Set(selection);
    const remove = document.panelOrder.filter((id) => !selected.has(document.panels[id]!.assetId));
    if (remove.length) commands.push({ type: "panel.remove", panelIds: remove });
    const existing = new Set(document.panelOrder.map((id) => document.panels[id]!.assetId));
    const additions = selection
      .filter((id) => !existing.has(id))
      .map((assetId) => {
        const asset = assets.find((a) => a.id === assetId);
        if (!asset?.normalized) throw new Error(t("wish.changed"));
        return { panelId: newKey(), assetId, viewport: asset.normalized.viewport };
      });
    if (additions.length) {
      const remaining = commands.length ? applyCommands(document, commands, lookup) : document;
      commands.push(...placePanelCommands(remaining, additions));
    }
  }
  const source = commands.length ? applyCommands(document, commands, lookup) : document;
  if (!source.panelOrder.length) throw new Error(t("wish.needFiles"));
  const intent = directEdit ?? interpretWish(words, source, brief ?? source.publicationContext, {
    notes: wish().notes,
    evidence: wish().evidence,
    selected: panelIdsOf(state.selection, source),
  });
  if (intent.kind === "clarify") return intent;
  if (intent.kind === "move") {
    commands.push(translateSelection(source, [intent.panelId], intent.dx, intent.dy));
    await commitWish(state.confirmed.revision, commands);
  } else if (intent.kind === "resize") {
    const panel = source.panels[intent.panelId]!;
    const width = intent.width ?? panel.frameMm.width * intent.factor;
    const right = panel.frameMm.x + width > source.canvas.widthMm;
    const bottom =
      panel.frameMm.y + (width * panel.frameMm.height) / panel.frameMm.width > source.canvas.heightMm;
    commands.push(
      scalePanel(
        source,
        intent.panelId,
        { width },
        bottom ? (right ? "bottom-right" : "bottom-left") : right ? "top-right" : "top-left",
      ),
    );
    await commitWish(state.confirmed.revision, commands);
  } else if (source.panelOrder.length === 1 && !curation) {
    const req = intent.request;
    const widthMm =
      req.family === "guided"
        ? req.widthMm
        : "canvasOverride" in req
          ? req.canvasOverride?.widthMm
          : undefined;
    if (widthMm && widthMm !== source.canvas.widthMm)
      commands.push({ type: "canvas.set", canvas: { ...source.canvas, widthMm } });
    await commitWish(state.confirmed.revision, commands);
  } else {
    let request = intent.request;
    const rows = wish().rows;
    if (
      selection &&
      rows.length &&
      request.family !== "guided" &&
      request.family !== "selection-row" &&
      !("rows" in request)
    ) {
      const panelFor = (assetId: string) =>
        source.panelOrder.find((id) => source.panels[id]!.assetId === assetId);
      const members = rows.flat();
      if (members.length === selection.length && selection.every((id) => members.includes(id))) {
        const primaryPanelId = primaryAsset && panelFor(primaryAsset);
        const groups = primaryPanelId
          ? rows.map(row => row.filter(id => id !== primaryAsset)).filter(row => row.length)
          : rows;
        request = {
          ...request,
          family: primaryPanelId ? "hero-top" : "rows",
          ...(primaryPanelId ? {primaryPanelId} : {}),
          rows: groups.map((row) => row.map((a) => "panel:" + panelFor(a))),
        };
      }
    }
    await commitWish(state.confirmed.revision, commands, request);
  }
  if (brief) rememberPublication(brief);
  return null;
}
export function replacementTarget(text: string): string | false | null {
  if (!/(?:替换|换成|换为|换掉|换一张|replace|swap)/i.test(text)) return false;
  const state = get(),
    doc = state.confirmed?.document;
  if (!doc) return null;
  const labels = text.match(/(?<![a-z0-9])(?:a[a-f]|[a-z])(?![a-z0-9])/gi) ?? [];
  const named = doc.panelOrder.filter((id) =>
    labels.some((l) => l.toUpperCase() === labelName(doc, id).toUpperCase()),
  );
  if (labels.length) return named.length === 1 ? named[0]! : null;
  return state.selection.kind === "panels" && state.selection.ids.length === 1
    ? state.selection.ids[0]!
    : null;
}
export type PendingSwap = {
  project: string;
  revision: number;
  command: Extract<DomainCommand, { type: "panel.replaceAsset" }>;
};
export async function swapImage(file: File, panelId: string, revision: number): Promise<PendingSwap | null> {
  const project = get().projectId,
    epoch = projectEpoch(),
    doc = get().confirmed?.document;
  if (!project || !doc?.panels[panelId] || revision !== get().confirmed?.revision)
    throw new Error(t("wish.changed"));
  const assetId = await importToLibrary(file);
  if (!assetId || !belongsToProject(project, epoch) || revision !== get().confirmed?.revision)
    throw new Error(t(assetId ? "wish.changed" : "assets.partial"));
  const command: PendingSwap["command"] = { type: "panel.replaceAsset", panelId, assetId };
  const next = applyCommands(doc, [command], assetLookup());
  const before = doc.panels[panelId]!,
    after = next.panels[panelId]!;
  if (
    !framesNearlyEqual(before.frameMm, after.frameMm) ||
    !cropsNearlyEqual(before.cropNormalized, after.cropNormalized)
  )
    return { project, revision, command };
  await commitWish(revision, [command]);
  return null;
}
const currentBrief = () => get().confirmed?.document.publicationContext;
function briefFor(goal: string) {
  const prior = currentBrief() ?? { ...lastPublication(), message: "", preference: "auto" as const };
  return publicationFrom(goal, prior);
}
export type WishModel = "local" | "text" | "thumbnails";
function tagsFor(r: FigureReading) {
  if (r.decision && r.decision.choice !== "image")
    return { evidence: r.decision.value, ignoreName: r.decision.choice !== "filename" };
  const labels = [...new Set([...r.text, ...r.local.svgText, ...r.local.ocrText])].join(" ").slice(0, 1300);
  const kind = r.category === "unknown" ? "" : figureKinds[r.category].join(" ");
  return {
    evidence: [r.decision?.value, kind, r.observation, labels].filter(Boolean).join(" "),
    ignoreName: Boolean(r.conflict),
  };
}
function rememberReadings(items: FigureReading[]) {
  const state = wish();
  const identities = {...state.identities};
  for (const item of items) {
    if (item.decision) identities[item.id] = {id:item.id, fingerprint:item.fingerprint, ...item.decision};
    else delete identities[item.id];
  }
  changeWish({ identities,
    readings: { ...state.readings, ...Object.fromEntries(items.map((r) => [r.id, r])) },
    evidence: { ...state.evidence, ...Object.fromEntries(items.map((r) => [r.id, tagsFor(r)])) },
  });
}
function questionFor(
  reading: FigureReading,
  filename: string,
  remaining: number,
  resume: IdentityQuestion["resume"],
): IdentityQuestion {
  return {
    id: reading.id,
    filename,
    fingerprint: reading.fingerprint,
    ...reading.conflict!,
    remaining,
    resume,
  };
}
export function reviseImageReading(reading: FigureReading) {
  const asset = libraryForWish().find((a) => a.id === reading.id);
  if (asset && reading.conflict) {
    rememberReadings([reading]);
    changeWish({ identity: questionFor(reading, asset.originalFilename, 1, null) });
  }
}
function rememberWishReply() {
  const state = wish();
  if (state.reply && !state.identity)
    changeWish({ turns: [...state.turns, ("PanelStudio · " + state.reply).slice(0, 1200)] });
}
export async function answerImageQuestion(choice: ConfirmFigureIdentity["choice"], value: string) {
  const state = wish(),
    pending = state.identity,
    project = get().projectId,
    epoch = projectEpoch();
  if (!project || !pending || state.busy || !value.trim()) return;
  changeWish({ busy: true });
  try {
    const decision = await api.confirmFigureIdentity(project, pending.id, {
      choice,
      value,
      fingerprint: pending.fingerprint,
    });
    if (!belongsToProject(project, epoch)) return;
    const reading = wish().readings[pending.id];
    if (reading) rememberReadings([{ ...reading, decision }]);
    changeWish({ identity: null, reply: "" });
    if (pending.swap) {
      await reflowCuratedSwap(pending.swap);
    } else if (pending.resume) {
      const { revision, text, action, model, configRevision } = pending.resume;
      if (get().confirmed?.revision !== revision) {
        changeWish({ input: wish().input || text, reply: t("wish.changed") });
        return;
      }
      let nextModel = model;
      if (model !== "local") {
        const provider = await api.providerSettings();
        if (!belongsToProject(project, epoch)) return;
        queryClient.setQueryData(["ai-provider"], provider);
        const current = preferredReadingMode(provider);
        if (current === "local") nextModel = "local";
        else if (current !== model || configRevision !== provider.configRevision) {
          changeWish({ input: wish().input || text, reply: t("reading.connectionChanged") });
          return;
        }
      }
      if (get().confirmed?.revision !== revision) {
        changeWish({ input: wish().input || text, reply: t("wish.changed") });
        return;
      }
      await handleWish(text, action, project, epoch, nextModel);
      if (belongsToProject(project, epoch)) rememberWishReply();
    }
  } catch (error) {
    if (belongsToProject(project, epoch))
      changeWish({ reply: errorText(error), input: wish().input || pending.resume?.text || state.input });
  } finally {
    if (belongsToProject(project, epoch)) changeWish({ busy: false });
  }
}

async function curateWish(
  text: string,
  id: string,
  epoch: number,
  all?: { ids: string[]; action: "say" | "draft" },
) {
  const state = wish();
  const curation = state.curation ?? beginCuration();
  const assets = libraryForWish().filter(asset => !all || all.ids.includes(asset.id));
  const revision = get().confirmed!.revision;
  const configRevision = cachedReadingProvider()?.configRevision;
  const locale = get().locale;
  const goal = state.goal && state.goal !== text ? [state.goal, text].filter(Boolean).join("；").slice(-1000) : text;
  const brief = briefFor(goal);
  changeWish({ phase: "select", curation: all ? null : curation, layoutRecovery: null, ...(all ? { selected: all.ids } : {}) });
  const result = await readForWish<FigureDiscussionReply | null>(id, epoch, t("wish.readAndReview"), async signal => {
    useWish.setState({reviewNotes:state.notes});
    try {
      const {items} = await api.readFigures(id, {
        assetIds:assets.map(asset=>asset.id), locale, vision:true, configRevision,
      },signal);
      signal.throwIfAborted();
      if (!belongsToProject(id,epoch)) return null;
      if (get().confirmed?.revision !== revision) throw new Error(t("wish.changed"));
      const notes = wish().reviewNotes ?? state.notes;
      useWish.setState({reviewNotes:null,reply:t("wish.curating")});
      rememberReadings(items);
      const unresolved = items.find(item => item.conflict && !item.decision);
      if (unresolved) return {kind:"question", identity:unresolved, picks:[], rows:[], reply:""};
      // The server reuses the visual readings. Only confirmed notes join this request.
      return await api.discussFigure(id, {
        assets: assets.map(asset => ({ id:asset.id, note:notes[asset.id] ?? "", selected:state.selected.includes(asset.id) })),
        turns: state.turns.length ? state.turns.slice(-12) : [text || t("wish.allRequest")],
        locale,
        publication: brief,
        thumbnails: true,
        configRevision,
        curation: all ? { allowQuestion: false, layoutAll: true } : { allowQuestion: !curation.asked },
      },signal);
    } finally {
      if (belongsToProject(id,epoch) && wish().reviewNotes) useWish.setState({reviewNotes:null});
    }
  });
  if (!result || !belongsToProject(id,epoch)) return;
  if (get().confirmed?.revision !== revision) throw new Error(t("wish.changed"));
  if (result.identity?.conflict) {
    const asset = assets.find(item => item.id === result.identity!.id);
    if (!asset) throw new Error(t("wish.changed"));
    rememberReadings([result.identity]);
    changeWish({
      reply: "",
      identity: questionFor(result.identity, asset.originalFilename, 1, { text, action:all?.action ?? "say", model:"thumbnails", revision, configRevision }),
    });
    return;
  }
  if (result.kind === "question") {
    changeWish({ goal, curation: { ...curation, asked:true }, reply: result.reply,
      question: { prompt:result.reply, options:result.options ?? [] } });
    return;
  }
  const rows = result.rows;
  const selected = rows.flat();
  const reasons = Object.fromEntries([...result.picks, ...(result.supplementary ?? [])].map(pick => [pick.id, pick.reason]));
  changeWish({ selected, rows, reasons, reply:t("wish.draftingCuration") });
  const width = figureWidth(text) ?? figureWidth(state.layout) ?? figureWidth(goal);
  const layout = width ? "canvas width " + width + " mm" : "";
  const proposal = {
    summary: result.reply, main: result.picks, supplementary: result.supplementary ?? [],
    rowSizes: rows.map(row => row.length),
  };
  const hero = rows[0]?.length === 1 && rows[0][0] === result.primaryId ? result.primaryId : undefined;
  try {
    const outcome = await makeDraft(layout, selected, brief, undefined, proposal, hero).catch(error => {
      if (!hero || !(error instanceof ApiClientError) || error.code !== "LAYOUT_CONFLICT") throw error;
      if (!belongsToProject(id, epoch)) throw error;
      return makeDraft(layout, selected, brief, undefined, proposal);
    });
    if (outcome?.kind === "clarify") throw new Error(t("wish.clarify", {part:outcome.fragment}));
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "LAYOUT_CONFLICT") throw error;
    if (belongsToProject(id, epoch)) changeWish({
      goal, layout, curation: null, layoutRecovery: {curation: proposal}, reply: t("wish.groupedLayoutConflict"),
    });
    return;
  }
  if (!belongsToProject(id,epoch)) return;
  changeWish({
    phase: "editing", goal, layout:"", curation:null, layoutRecovery:null,
    reply: t("wish.firstReady") + (get().confirmed?.document.curation ? " " + result.reply : ""),
  });
  patch({ fittedProjectId:null, inspectorMode:"properties", rightOpen:false, leftOpen:false });
}

async function reviseNarrativeFocus(text: string, id: string, epoch: number) {
  const { document, revision } = get().confirmed!;
  const state = wish();
  const primaryCandidates = new Set(document.panelOrder.map(panelId => document.panels[panelId]!.assetId));
  const available = new Set(libraryForWish().map(asset => asset.id));
  const supplementary = document.curation?.supplementary.filter(pick => !primaryCandidates.has(pick.id) && available.has(pick.id)) ?? [];
  const brief = briefFor(text);
  const result = await readForWish(id, epoch, t("wish.findingFocus"), signal => api.discussFigure(id, {
    assets: [...primaryCandidates, ...supplementary.map(pick => pick.id)].map(assetId => ({
      id: assetId, note: state.notes[assetId] ?? "", selected: primaryCandidates.has(assetId),
    })),
    turns: [...state.turns.slice(0, -1).slice(-11), text],
    publication: brief,
    locale: get().locale,
    thumbnails: true,
    configRevision: cachedReadingProvider()?.configRevision,
    curation: { allowQuestion: false, focusRevision: true },
  }, signal));
  if (!result || !belongsToProject(id, epoch)) return;
  if (get().confirmed?.revision !== revision) throw new Error(t("wish.changed"));
  if (result.promotion && document.panelOrder.length < limit && supplementary.some(pick => pick.id === result.promotion!.id)) {
    const { question, accept, keep } = result.promotion;
    changeWish({ focusChoice: { revision, goal: text, proposal: result }, question: { prompt: question, options: [accept, keep] }, reply: question });
    return;
  }
  await applyNarrativeFocus(text, id, epoch, revision, result);
}

async function applyNarrativeFocus(text: string, id: string, epoch: number, revision: number,
  proposal: FigureDiscussionReply, promote = false) {
  const confirmed = get().confirmed;
  if (!confirmed || confirmed.revision !== revision) throw new Error(t("wish.changed"));
  const previous = confirmed.document;
  const brief = briefFor(text);
  const preparation: DomainCommand[] = [];
  const addition = promote ? proposal.promotion : undefined;
  if (!addition && proposal.kind === "question") {
    changeWish({ reply: t("wish.keptMain") });
    return;
  }
  let document = previous;
  let result = proposal;
  const existing = curatedPanelRows(previous);
  if (addition) {
    const asset = libraryForWish().find(item => item.id === addition.id);
    if (!asset?.normalized || previous.panelOrder.length >= limit ||
        !previous.curation?.supplementary.some(pick => pick.id === addition.id)) throw new Error(t("wish.changed"));
    const panelId = newKey();
    const oldRows = existing.length ? existing.map(row => row.map(panel => previous.panels[panel]!.assetId))
      : previous.panelOrder.map(panel => [previous.panels[panel]!.assetId]);
    const originalPicks = new Map(previous.curation.main.map(pick => [pick.id, pick]));
    const originalMain = previous.panelOrder.map(panel => {
      const id = previous.panels[panel]!.assetId;
      return originalPicks.get(id) ?? { id, reason: t("wish.currentMain") };
    });
    preparation.push(...placePanelCommands(previous, [{ panelId, assetId: asset.id, viewport: asset.normalized.viewport }]));
    document = applyCommands(previous, preparation, assetLookup());
    if (existing.length) existing.push([panelId]);
    result = { ...proposal, kind: "proposal", reply: addition.reason, primaryId: asset.id,
      picks: [...(proposal.kind === "proposal" ? proposal.picks : originalMain), { id: asset.id, reason: addition.reason }],
      rows: [...(proposal.kind === "proposal" ? proposal.rows : oldRows), [asset.id]] };
  }
  const primary = document.panelOrder.find(panelId => document.panels[panelId]!.assetId === result.primaryId);
  const logicalRows = primary && result.kind === "proposal" ? narrativeRows(document, result, primary, existing) : null;
  if (!primary || !logicalRows) throw new Error(t("wish.focusNoEvidence"));

  const frame = document.panels[primary]!.frameMm;
  const { widthMm, marginsMm } = document.canvas;
  const innerWidth = widthMm - marginsMm.left - marginsMm.right;
  const focusRow = logicalRows.find(row => row.includes(primary))!;
  const target = focusRow.length === 1 ? innerWidth * 0.62 : 0;
  const minimumWidthMm = Math.min(innerWidth - 0.1, Math.max(target, frame.width + Math.min(12, frame.width * 0.2)));
  const picks = new Map(result.picks.map(pick => [pick.id, pick]));
  const main = document.panelOrder.flatMap(panelId => {
    const pick = picks.get(document.panels[panelId]!.assetId);
    return pick ? [pick] : [];
  });
  if (main.length !== document.panelOrder.length) throw new Error(t("wish.focusNoEvidence"));
  const suggestions = result.suggestedSupplementary?.filter(pick => picks.has(pick.id) && pick.id !== result.primaryId);
  const curation: FigureCuration = {
    summary: result.reply,
    main,
    supplementary: previous.curation?.supplementary.filter(pick => !picks.has(pick.id)) ?? [],
    rowSizes: logicalRows.map(row => row.length),
    ...(suggestions?.length ? { suggestedSupplementary: suggestions } : {}),
  };
  const place = ({ rows, alignedRows }: ReturnType<typeof layoutNarrativeRows>, maxAutoHeightMm = 360) => commitWish(revision, [
      ...preparation,
      { type: "figure.setPublicationContext", publicationContext: brief },
      { type: "figure.setCuration", curation },
    ], {
      family: "rows", rows, primaryPanelId: primary,
      emphasis: { minimumWidthMm, maxAutoHeightMm, alignedRows },
    }, primary);
  const layout = layoutNarrativeRows(document, logicalRows);
  const fitConflict = (error: unknown) => error instanceof ApiClientError && error.code === "LAYOUT_CONFLICT";
  try {
    await place(layout, addition ? 320 : 360).catch(error => {
      if (!fitConflict(error) || !belongsToProject(id, epoch)) throw error;
      if (addition) return place(layout);
      if (focusRow.length === 1 ||
          layout.alignedRows.some(row => row.includes("panel:" + primary))) throw error;
      return place(layoutNarrativeRows(document, logicalRows, primary));
    });
  } catch (error) {
    if (!fitConflict(error)) throw error;
    if (belongsToProject(id, epoch)) changeWish({
      reply: addition ? t("wish.promotionNoRoom") : t("wish.focusNoRoom", { panel: labelName(document, primary) }),
    });
    return;
  }
  if (!belongsToProject(id, epoch)) return;
  changeWish({ goal: text, reply: result.reply });
  patch({ fittedProjectId: null });
}

async function reflowCuratedSwap({ panelId, assetId, revision }: CuratedSwap) {
  const { projectId, confirmed } = get();
  const document = confirmed?.document;
  const draft = document?.curation;
  if (!projectId || !draft || !document?.panels[panelId] || confirmed!.revision !== revision ||
      !libraryForWish().some(asset => asset.id === assetId) ||
      Object.values(document.panels).some(panel => panel.assetId === assetId)) throw new Error(t("wish.changed"));
  const logicalRows = curatedPanelRows(document);
  const primary = document.layoutSettings.primaryPanelId;
  const focus = logicalRows.length && primary && !Object.keys(document.groups).length ? primary : null;
  const { rows, alignedRows } = layoutNarrativeRows(document, logicalRows);
  const { widthMm, marginsMm } = document.canvas;
  const innerWidth = widthMm - marginsMm.left - marginsMm.right;
  await commitWish(revision, [{ type:"panel.replaceAsset", panelId, assetId }], {
    family:"rows", ...(rows.length ? { rows: focus ? rows : logicalRows.map(row => row.map(id => "panel:" + id)) } : {}),
    ...(focus ? {
      primaryPanelId: focus,
      emphasis: { minimumWidthMm: Math.min(document.panels[focus]!.frameMm.width, innerWidth * 0.45), alignedRows },
    } : {}),
  });
  if (get().projectId === projectId) changeWish({reply:t("wish.curatedSwapped")});
}

export async function replaceCuratedPanel(panelId: string, assetId: string) {
  const state = wish();
  const { projectId, confirmed, crop, compareMode } = get();
  const epoch = projectEpoch();
  if (!projectId || state.busy || state.identity || !confirmed || crop || compareMode !== "editing")
    throw new Error(t("wish.finishEdit"));
  const asset = libraryForWish().find(item => item.id === assetId);
  if (!asset) throw new Error(t("wish.changed"));
  const swap = { panelId, assetId, revision:confirmed.revision };
  changeWish({busy:true,editFeedback:null});
  try {
    const {items} = await api.readFigures(projectId,{assetIds:[assetId],vision:false,preferSaved:true,locale:get().locale});
    if (!belongsToProject(projectId,epoch)) return;
    if (get().confirmed?.revision !== swap.revision) throw new Error(t("wish.changed"));
    const reading = items[0];
    if (reading?.conflict && !reading.decision) {
      rememberReadings([reading]);
      changeWish({identity:{...questionFor(reading,asset.originalFilename,1,null),swap},reply:""});
      return;
    }
    await reflowCuratedSwap(swap);
  } finally {
    if (belongsToProject(projectId,epoch)) changeWish({busy:false});
  }
}

async function applyModelEdit(text: string, model: WishModel, project: string, epoch: number) {
  const index = wish().turns.findLastIndex(turn => !turn.startsWith("PanelStudio · "));
  const point = wish().checkpoints[index];
  await generateAi(text, {
    onQueued:jobId => {
      if (point && belongsToProject(project,epoch))
        changeWish({checkpoints:{...wish().checkpoints,[index]:{...point,aiJob:jobId}}});
    },
    includePreviewImage: model === "thumbnails",
    visualReview: false,
    fromCurrent: !get().awaitingAnswer,
  });
  if (!belongsToProject(project, epoch)) return false;
  const ai = get().aiStatus,
    pending = get().awaitingAnswer;
  if (ai.phase === "cancelled") { changeWish({reply:t("chat.stopped")}); return false; }
  if (ai.phase === "clarification" && pending) {
    changeWish({
      reply: ai.question,
      question: { prompt: ai.question, options: pending.options, jobId: pending.jobId },
    });
    return false;
  }
  if (ai.phase !== "idle" || !get().activeCandidateId)
    throw new Error(get().liveMessage || t("wish.clarify", { part: text }));
  await acceptCandidate(true);
  if (get().activeCandidateId || get().saveState !== "saved") throw new Error(get().liveMessage);
  return true;
}
async function handleWish(
  text: string,
  action: "say" | "draft",
  id: string,
  epoch: number,
  model: WishModel,
) {
  const state = wish();
  const assets = libraryForWish();
  if (!assets.length) {
    changeWish({ input: wish().input || text, reply: t("wish.needFiles") });
    return;
  }
  if (get().crop || get().draft || get().compareMode !== "editing") throw new Error(t("wish.finishEdit"));
  if (/^(撤销|撤消|undo)$/i.test(text)) {
    changeWish({ focusChoice: null });
    await undo();
    return;
  }
  if (state.focusChoice) {
    const { proposal, goal, revision } = state.focusChoice;
    const promotion = proposal.promotion;
    changeWish({ focusChoice: null });
    if (action === "say" && promotion) {
      const promote = text === promotion.accept || /^(?:可以|好|同意)?\s*(?:加到|加进|放到|放进|纳入)(?:正文|主图)[。！!]?$/u.test(text);
      const keep = text === promotion.keep || /^(?:不加|先不加|不用加|保留(?:原有|现在的)主图)[。！!]?$/u.test(text);
      if (promote || keep) {
        if (get().confirmed?.revision !== revision) {
          changeWish({ reply: t("wish.changed"), input: goal });
          return;
        }
        await applyNarrativeFocus(goal, id, epoch, revision, proposal, promote);
        return;
      }
    }
  }
  const requestsSelection = asksForSelection(text);
  const clauses = text.split(/[,，。；;\n]+/u).map(part=>part.trim()).filter(Boolean);
  const allImages = clauses.some(part => allImagesClause(part, assets.length));
  const layoutWords = clauses.filter(part => !allImagesClause(part, assets.length));
  if (action === "say" && !requestsSelection && !state.curation && uncertainLayout(text)) {
    const details = clauses.filter(part => !uncertainLayout(part) || selectionLayoutPart(part));
    if (details.length) changeWish({goal: [state.goal, ...details].filter(Boolean).join("；").slice(-1000)});
    const draftWords = details.filter(part => selectionLayoutPart(part) || allImagesClause(part, assets.length));
    return handleWish(draftWords.join("，"), "draft", id, epoch, model);
  }

  const doc = get().confirmed!;
  const story = state.phase === "select";
  const canvasAssets = doc.document.panelOrder.map(panelId => doc.document.panels[panelId]!.assetId);
  if (action === "say" && state.phase === "editing" && !get().awaitingAnswer && model === "thumbnails" &&
      canvasAssets.length > 1 && new Set(canvasAssets).size === canvasAssets.length &&
      !Object.keys(doc.document.groups).length && narrativeFocus(text)) {
    await reviseNarrativeFocus(text, id, epoch);
    return;
  }
  const fullSelection = allImages ? assets.map(asset => asset.id)
    : story ? state.selected : canvasAssets.length ? canvasAssets : assets.map(asset => asset.id);
  const autoDraft = (action === "draft" && !text && !state.layout) || automatic(text) ||
    (allImages && layoutWords.every(part => Boolean(figureWidth(part))));
  const canPlanAll = fullSelection.length >= 2 && new Set(fullSelection).size === fullSelection.length &&
    !(story && state.rows.length) &&
    (state.phase !== "editing" || allImages) && autoDraft;
  if (model === "thumbnails" && canPlanAll) {
    try {
      await curateWish(text, id, epoch, {ids: fullSelection, action});
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code !== "MODEL_OUTPUT_INVALID" || !belongsToProject(id,epoch)) throw error;
      changeWish({ phase: state.phase, rows: [], selected: state.selected, curation: null });
      await handleWish(text, action, id, epoch, "local");
    }
    return;
  }
  if (action === "say" && state.phase !== "editing" && model === "thumbnails" && !doc.document.curation &&
      (state.curation || requestsCuration(text, assets.length))) {
    await curateWish(text,id,epoch);
    return;
  }
  const mentioned = publicationFrom(text);
  const suppliedContext = Boolean(mentioned.journal || mentioned.field);
  const pair = !suppliedContext && action === "say" ? localPairRequest(text, doc.document) : undefined;
  if (pair && state.phase === "editing") {
    try {
      await commitWish(doc.revision, [], pair);
      if (belongsToProject(id, epoch)) changeWish({ reply: t("wish.updated") });
    } catch (error) {
      if (!belongsToProject(id, epoch)) return;
      if (!(error instanceof ApiClientError) || error.code !== "LAYOUT_CONFLICT") throw error;
      const prompt = t("wish.pairNoRoom");
      changeWish({ reply: prompt, question: { prompt, options: [t("wish.arrangeWhole")] } });
    }
    return;
  }
  // A move or resize aimed at a panel label or the current selection needs only the saved geometry.
  const interpreted = state.phase === "editing" && action === "say" && !requestsSelection && !suppliedContext
    ? interpretWish(text, doc.document, doc.document.publicationContext, {
        selected: panelIdsOf(get().selection, doc.document),
        explicitPanelsOnly: true,
      })
    : null;
  const directEdit = interpreted?.kind === "move" || interpreted?.kind === "resize" ? interpreted : undefined;
  const configRevision = model === "local" ? undefined : cachedReadingProvider()?.configRevision;
  if (!directEdit && !(model === "local" && autoDraft)) {
    const useLibrary = story || requestsSelection || !doc.document.panelOrder.length;
    const onCanvas = new Set(Object.values(doc.document.panels).map((p) => p.assetId));
    const relevant = assets
      .filter((a) => useLibrary || onCanvas.has(a.id))
      .filter((a) => !(story && action === "draft") || state.selected.includes(a.id));
    if (relevant.length) {
      const reading = await readForWish(id,epoch,t(model === "thumbnails" ? "wish.readingCloud" : "wish.readingLocal"), signal => api.readFigures(id, {
        assetIds: relevant.map((a) => a.id),
        locale: get().locale,
        vision: model === "thumbnails",
        configRevision,
        preferSaved: model !== "thumbnails",
      },signal));
      if (!reading || !belongsToProject(id, epoch)) return;
      const { items } = reading;
      if (get().confirmed?.revision !== doc.revision) throw new Error(t("wish.changed"));
      rememberReadings(items);
      const unresolved = items.filter((r) => r.conflict && !r.decision);
      if (unresolved.length) {
        const r = unresolved[0]!,
          asset = relevant.find((a) => a.id === r.id)!;
        changeWish({
          reply: "",
          identity: questionFor(r, asset.originalFilename, unresolved.length, {
            text,
            action,
            model,
            revision: doc.revision,
            configRevision,
          }),
        });
        return;
      }
      changeWish({ reply: "" });
    }
  }
  if (
    story && !allImages &&
    action === "say" &&
    (automatic(text) ||
      /^(?:好[，, ]*)?(?:就用|采用|就按)(?:这|刚才|选中|勾选).*(?:排|做|出稿)|^use (?:these|the selected).*(?:draft|arrange)/i.test(
        text,
      ))
  ) {
    const extra = text
      .split(/[,，。；;]/)
      .slice(1)
      .join("，");
    return handleWish(extra, "draft", id, epoch, model);
  }
  if (action === "say" && !allImages && (story || requestsSelection)) {
    if (!story) openSelection();
    const parts = text.split(/[,，。；;\n]+/).filter(Boolean);
    const spatial = parts.filter(selectionLayoutPart);
    if (spatial.length) changeWish({ layout: spatial.join("，") });
    const discussion = parts.filter((part) => !spatial.includes(part)).join("，");
    if (!discussion && spatial.length) {
      if (wish().selected.length) return handleWish(spatial.join("，"), "draft", id, epoch, model);
      changeWish({ reply: t("wish.revised", { count: wish().selected.length }) });
      return;
    }
    if (model !== "local") {
      const local = wish();
      const version = get().confirmed?.revision;
      const result = await readForWish(id,epoch,t("chat.thinking"),signal => api.discussFigure(id, {
        assets:assets.map(asset => ({id:asset.id,note:local.notes[asset.id] ?? "",selected:local.selected.includes(asset.id)})),
        turns:local.turns.slice(0,local.turns.findLastIndex(turn => !turn.startsWith("PanelStudio · ")) + 1).slice(-12),
        locale:get().locale, publication:briefFor(local.goal || discussion), thumbnails:model === "thumbnails",configRevision,
      },signal));
      if (!result || !belongsToProject(id,epoch)) return;
      if (get().confirmed?.revision !== version) throw new Error(t("wish.changed"));
      const goal = [local.goal, discussion].filter(Boolean).join("；").slice(-1000);
      changeWish({
        goal,
        reply: result.reply,
        question: result.kind === "question" ? { prompt: result.reply, options: result.options ?? [] } : null,
        ...(result.kind === "proposal"
          ? {
              selected: result.picks.map((p) => p.id),
              rows: result.rows,
              layoutRecovery: null,
              reasons: Object.fromEntries(result.picks.map((p) => [p.id, p.reason])),
            }
          : {}),
      });
    } else if (discussion) reviewSelection(discussion, libraryForWish());
    else changeWish({ reply: t("wish.revised", { count: wish().selected.length }) });
    return;
  }
  const hasLayout =
    /间距|并排|上下|毫米|放大|缩小|\d\s*mm\b|side.by.side|(?:放|排)在[左右下]|横版|竖版|突出|主图|larger|smaller/i.test(text);
  if (state.phase === "editing" && suppliedContext && !hasLayout && !allImages) {
    const brief = briefFor(text);
    await commitWish(get().confirmed!.revision, [
      { type: "figure.setPublicationContext", publicationContext: brief },
    ]);
    if (belongsToProject(id, epoch)) {
      rememberPublication(brief);
      changeWish({ goal: brief.message, reply: t("wish.briefSaved") });
    }
    return;
  }
  const collectBrief = state.phase === "brief" && action === "say" && !automatic(text);
  const goal = collectBrief ? [state.goal, text].filter(Boolean).join("；") : state.goal;
  const brief =
    state.phase === "editing"
      ? suppliedContext
        ? briefFor(text)
        : undefined
      : briefFor(goal || (action === "say" && !automatic(text) ? text : ""));
  const whole = /^(?:重排整图|重新排版整张图|rearrange the whole figure)[。.!]?$/iu.test(text);
  const words = (allImages ? layoutWords.join("，") : whole ? "" : action === "draft" ? text || state.layout : collectBrief && !hasLayout ? "" : text).trim();

  const selected = allImages ? fullSelection : story ? state.selected : undefined;
  const needPick = !get().confirmed?.document.panelOrder.length && !selected;
  if (needPick && assets.length > limit) {
    openSelection();
    return;
  }
  const selection = selected ?? (needPick ? assets.map((a) => a.id) : undefined);
  const retained = story && action === "draft" ? state.layoutRecovery?.curation : null;
  let result: Awaited<ReturnType<typeof makeDraft>>;
  try {
    result = await makeDraft(words, selection, brief, directEdit, retained ?? undefined);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "LAYOUT_CONFLICT" || !story || !state.rows.length) throw error;
    if (belongsToProject(id, epoch)) changeWish({
      layout: words, layoutRecovery: {curation: retained ?? null}, reply: t("wish.groupedLayoutConflict"),
    });
    return;
  }
  if (!belongsToProject(id, epoch)) return;
  if (result?.kind === "clarify") {
    if (
      state.phase !== "editing" &&
      !hasLayout &&
      /比较|对照|展示|研究|投稿|定位|compare|show|audience|journal/i.test(text)
    ) {
      await makeDraft("", selection, briefFor(text));
    } else {
      const provider = model === "local" ? null : await api.providerSettings();
      if (!belongsToProject(id, epoch)) return;
      if (
        provider?.config &&
        provider.hasSecret &&
        !story &&
        get().confirmed!.document.panelOrder.length >= 2
      ) {
        if (!(await applyModelEdit(text, model, id, epoch))) return;
      } else {
        if (state.phase === "editing") {
          changeWish({ reply: t("wish.clarify", { part: result.fragment }), input: wish().input || text });
        } else {
          changeWish({ reply: t("wish.firstClarify") });
        }
        return;
      }
    }
  }
  if (!belongsToProject(id, epoch)) return;
  const first = state.phase !== "editing";
  let reply = t(first ? "wish.firstReady" : "wish.updated");
  if (first && pair && get().confirmed) {
    const changes = proposalChanges(doc.document, get().confirmed!.document);
    const canvas = changes.find(item => item.kind === "canvas");
    const panels = [...new Set(changes.flatMap(item => item.kind === "move" || item.kind === "size" ? [item.label] : []))];
    if (panels.length) reply += " " + t("wish.firstPanels", { panels: panels.join(", ") });
    if (canvas) reply += " " + t("wish.firstCanvas", canvas);
  }
  changeWish({ phase: "editing", goal, layout: "", layoutRecovery: null, reply });
  if (first) patch({ fittedProjectId: null, inspectorMode: "properties", rightOpen: false, leftOpen: false });
}
function checkpoint(action: "say" | "draft", version = firstVersion()): WishCheckpoint | null {
  const state = wish(), workspace = get();
  if (!workspace.confirmed || !state.projectId) return null;
  const {phase,goal,layout,selected,order,rows,reasons,notes,reply,question,curation,layoutRecovery,focusChoice} = state;
  return { version, source:state.projectId, revision:workspace.confirmed.revision, assets:libraryForWish().map(a => a.id),
    panelIds:panelIdsOf(workspace.selection, workspace.confirmed.document), identities:Object.values(state.identities), action,
    before:{phase,goal,layout,selected,order,rows,reasons,notes,reply,question,curation,layoutRecovery,focusChoice} };
}

export function seedMessageBranch(project: string, state: WishSession, index: number, point: WishCheckpoint, version: VersionRef, text: string, jobId: string | null, handoff?: {select:boolean;curate:boolean;goal?:string;layout:string}) {
  const preceding = Object.fromEntries(Object.entries(state.checkpoints).filter(([at]) => Number(at) < index));
  const forkPoint: WishCheckpoint = { ...point, source:project, revision:0, version, aiJob:jobId ?? undefined };
  seedWish(project, { ...point.before, ...(handoff ? {phase:handoff.select || handoff.curate ? "select" : "draft",curation:handoff.curate ? beginCuration() : null,goal:handoff.goal ?? "",layout:handoff.layout} : {}), turns:[...state.turns.slice(0,index),text], checkpoints:{...preceding,[index]:forkPoint},
    opening:state.opening ? {...state.opening,path:{...state.opening.path,projectId:project}} : null,
    identities:Object.fromEntries(point.identities.map(item => [item.id,item])),
    input:state.input, question:point.before.question?.jobId ? null : point.before.question,
    focusChoice:point.before.focusChoice ? {...point.before.focusChoice, revision:0} : null });
}

export async function submitWish(
  raw: string,
  action: "say" | "draft" = "say",
  model: WishModel = "local",
  recordTurn = true,
  version?: VersionRef,
) {
  const id = get().projectId,
    epoch = projectEpoch(),
    state = wish(),
    text = raw.trim();
  if (!id || state.projectId !== id || state.busy || state.identity || (!text && action === "say")) return;
  const point = text && recordTurn ? checkpoint(action, version) : null;
  changeWish({
    ...(point ? {checkpoints:{...state.checkpoints,[state.turns.length]:point}} : {}),
    busy: true,
    input: !version && state.input.trim() === text ? "" : state.input,
    reply: "",
    editFeedback: null,
    question: null,
    turns: text && recordTurn ? [...state.turns, text] : state.turns,
  });
  try {
    if (state.question?.jobId && action === "say" && model !== "local") {
      const pending = get().awaitingAnswer;
      if (
        !pending ||
        pending.jobId !== state.question.jobId ||
        pending.baseRevision !== get().confirmed?.revision
      ) {
        changeWish({ input: wish().input || text, reply: t("wish.changed"), turns: state.turns, checkpoints:state.checkpoints });
        return;
      }
      if (await applyModelEdit(text, model, id, epoch))
        changeWish({ phase: "editing", reply: t("wish.updated") });
    } else await handleWish(text, action, id, epoch, model);
    if (belongsToProject(id, epoch)) rememberWishReply();
  } catch (error) {
    if (belongsToProject(id, epoch)) {
      const current = get().confirmed;
      const resize = current && (error instanceof ApiClientError || error instanceof DocumentCommandError) && error.code === "OUTSIDE_CANVAS"
        ? interpretWish(text, current.document, undefined, { explicitPanelsOnly: true, selected: panelIdsOf(get().selection, current.document) })
        : undefined;
      if (resize?.kind === "resize" && current) {
        const panel = labelName(current.document, resize.panelId);
        if (panel) {
          const prompt = t("wish.resizeNoRoom", { panel });
          changeWish({ reply: prompt, question: { prompt, options: [t("wish.tryShrink", { panel })] } });
          rememberWishReply();
          return;
        }
      }
      changeWish({
        reply:
          error instanceof Error &&
          !(error instanceof ApiClientError || error instanceof DocumentCommandError)
            ? error.message
            : errorText(error),
        input: wish().input || text,
        question: state.question,
        focusChoice: state.focusChoice,
        ...(version && point ? {turns:[...state.turns,text], checkpoints:{...state.checkpoints,[state.turns.length]:point}} : {turns:state.turns,checkpoints:state.checkpoints}),
      });
    }
  } finally {
    if (belongsToProject(id, epoch)) changeWish({ busy: false });
  }
}
