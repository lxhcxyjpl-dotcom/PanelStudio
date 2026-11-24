import { create } from "zustand";
import { RESOURCE_LIMITS, type OpeningTurn, type FigureBriefReply } from "@panelstudio/contracts";
import { api } from "../api/client";
import { i18n } from "../i18n";
import { enUS, zhCN } from "../i18n/catalog";
import { ensureEditorFonts } from "../editor-fonts";
import { errorText } from "../model/feedback";
import { allImagesClause, asksForSelection, figureWidth, requestsCuration, selectionLayoutPart } from "../model/wish";
import { cachedReadingProvider, preferredReadingMode } from "./reading-preference";
import { useWorkspace } from "./store";
import { saveOpeningArchive, useWish } from "./wish-session";
import { openListedProject } from "./session";
import { navigate } from "../navigation";
import { startWithWish } from "./wish";

type Brief = Pick<FigureBriefReply, "request" | "intent"> & { question: { prompt: string; options: string[] } | null };
export type MessageVersion = { group: string; number: number };
type ChatTurn = OpeningTurn & { version?: MessageVersion; brief?: Brief; delivery?: "pending" | "stopped" | "failed"; error?: string; partial?: string };
export type OpeningPath = Brief & { pathId: string; turns: ChatTurn[]; projectId?: string };
export type OpeningArchive = { path: OpeningPath; alternatives: OpeningPath[] };
type Opening = OpeningPath & {
  generation: number; preview: string; alternatives: OpeningPath[]; draft: string; lostFiles: number;
  files: File[]; busy: "reply" | "upload" | null; error: string;
};
const key = "panelstudio.opening.v1";
const emptyBrief = (): Brief => ({ request: "", intent: "undecided", question: null });
const empty = (): Opening => ({
  ...emptyBrief(), pathId: crypto.randomUUID(), turns: [], alternatives: [], generation: 0, preview: "",
  draft: "", lostFiles: 0, files: [], busy: null, error: "",
});
function briefOf(value: Partial<Brief>): Brief {
  const question = value.question;
  const generic = question && [enUS, zhCN].some(messages =>
    question.prompt === messages["chat.openQuestion"] && question.options?.length === 3 &&
    (["chat.compare", "chat.trend", "chat.process"] as const).every((key, index) =>
      question.options[index] === messages[key]));
  return {
    request: typeof value.request === "string" ? value.request.slice(0, 1000) : "",
    intent: value.intent === "select" || value.intent === "arrange" ? value.intent : "undecided",
    question: question && !generic && typeof question.prompt === "string" && Array.isArray(question.options) &&
      question.options.every(option => typeof option === "string") ? question : null,
  };
}
function readPath(value: Partial<OpeningPath> | null): OpeningPath | null {
  if (!value || !Array.isArray(value.turns) || !value.turns.every(turn => turn &&
    (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string")) return null;
  const turns = value.turns.map((turn): ChatTurn => {
    const item: ChatTurn = { role: turn.role, text: turn.text };
    if (turn.role === "user") {
      item.version = typeof turn.version?.group === "string" && Number.isSafeInteger(turn.version.number) && turn.version.number > 0
        ? turn.version : { group: crypto.randomUUID(), number: 1 };
      if (turn.delivery) item.delivery = turn.delivery === "failed" ? "failed" : "stopped";
    }
    if (turn.brief && typeof turn.brief === "object") item.brief = briefOf(turn.brief);
    if (item.delivery && typeof turn.partial === "string") item.partial = turn.partial;
    if (item.delivery === "failed" && typeof turn.error === "string") item.error = turn.error;
    return item;
  });
  return { ...briefOf(value), turns, pathId: typeof value.pathId === "string" ? value.pathId : crypto.randomUUID(),
    ...(typeof value.projectId === "string" ? { projectId: value.projectId } : {}) };
}
function pathOf(state: Opening): OpeningPath {
  return { ...briefOf(state), pathId: state.pathId, turns: state.turns, ...(state.projectId ? {projectId:state.projectId} : {}) };
}
function restored(): Opening {
  const entry = empty();
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    const path = readPath(value);
    if (path) {
      Object.assign(entry, path);
      entry.draft = typeof value.draft === "string" ? value.draft.slice(0, 1000) : "";
      entry.lostFiles = Number.isSafeInteger(value.stagedCount) ? value.stagedCount : 0;
      if (Array.isArray(value.alternatives)) entry.alternatives = value.alternatives.map(readPath).filter(Boolean);
    }
  } catch { /* A new conversation also works without session storage. */ }
  return entry;
}
export const useOpening = create<Opening>(restored);
let epoch = 0;
let pendingReply: AbortController | undefined;
const tr = (key: string, values?: Record<string, unknown>) => String(i18n.t(key, values ?? {}));
function update(changes: Partial<Opening>) {
  useOpening.setState(changes);
  const state = useOpening.getState();
  const { alternatives, draft, busy, files, lostFiles } = state;
  if (busy === "upload") return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...pathOf(state), alternatives, draft, stagedCount: files.length || lostFiles }),
    );
  } catch {}
}
export function resetOpening() {
  epoch++;
  pendingReply?.abort();
  pendingReply = undefined;
  update({ ...empty(), projectId: undefined, generation: useOpening.getState().generation + 1 });
}
export function openingDraft(value: string) {
  update({ draft: value, error: "" });
}
export function stageFiles(incoming: File[]) {
  const state = useOpening.getState();
  if (state.busy === "upload") return;
  const allowed = incoming.filter(
    (f) =>
      /\.(?:svg|png|jpe?g|webp)$/iu.test(f.name) ||
      ["image/svg+xml", "image/png", "image/jpeg", "image/webp"].includes(f.type),
  );
  if (state.files.length + allowed.length > RESOURCE_LIMITS.maxAssetsPerProject) {
    update({ error: tr("chat.fileLimit", { count: RESOURCE_LIMITS.maxAssetsPerProject }) });
    return;
  }
  update({
    files: [...state.files, ...allowed],
    lostFiles: allowed.length ? 0 : state.lostFiles,
    error: allowed.length === incoming.length ? "" : tr("chat.unsupported"),
  });
}
export function unstageFile(index: number) {
  const state = useOpening.getState();
  if (state.busy !== "upload") update({ files: state.files.filter((_, i) => i !== index), error: "" });
}
function mergedRequest(previous: string, latest: string) {
  if (!latest || !previous) return latest || previous;
  const room = 1000 - latest.length - 1;
  return room > 0 ? previous.slice(0, room) + "，" + latest : latest;
}
function authorLayout(turns: OpeningTurn[]) {
  const clauses = turns
    .filter((t) => t.role === "user")
    .flatMap((t) => t.text.split(/[,，。；;\n]+/u).map((s) => s.trim()));
  let width = "";
  const placement: string[] = [];
  for (const clause of clauses) {
    const explicit = figureWidth(clause);
    if (explicit) width = explicit + " mm";
    if (!explicit && selectionLayoutPart(clause)) placement.push(clause);
  }
  if (width) placement.push((i18n.language.startsWith("zh") ? "整张宽 " : "figure width ") + width);
  return [...new Set(placement)].join("，");
}
function selectionRequested(turns: OpeningTurn[], fallback: boolean, imageCount?: number) {
  let selected = fallback;
  for (const { role, text } of turns) {
    if (role !== "user") continue;
    if (
      text.split(/[,，。；;\n]+/u).some(part => allImagesClause(part, imageCount)) ||
      /全部(?:放|用|排)|所有(?:的)?图都|已(?:经)?选好|use (?:all|every) (?:the )?(?:panels|images|figures)|already (?:chose|selected)/iu.test(
        text,
      )
    )
      selected = false;
    else if (asksForSelection(text)) selected = true;
  }
  return selected;
}
function offlineOpening(text: string, prev: Opening): FigureBriefReply {
  const combined = mergedRequest(prev.request, text);
  const intent = selectionRequested([{ role: "user", text }], prev.intent === "select")
    ? "select"
    : "arrange";
  return {
    kind: "ready",
    intent,
    reply: tr(asksForSelection(combined) ? "chat.nextFiles" : "chat.ready"),
    options: [],
    request: combined,
  };
}
export function stopOpening() {
  const state = useOpening.getState();
  if (!pendingReply || state.busy !== "reply") return;
  ++epoch;
  pendingReply.abort();
  pendingReply = undefined;
  const turns = state.turns.map((turn): ChatTurn => turn.delivery === "pending" ? { ...turn, delivery: "stopped", partial: state.preview } : turn);
  update({ turns, busy: null, preview: "" });
}

export function retryOpening(fresh: boolean) {
  const last = useOpening.getState().turns.at(-1);
  if (last?.delivery === "failed" || last?.delivery === "stopped")
    return submitOpening(last.text, fresh, [], true);
}

export function openingVersionIndex(path: OpeningPath, alternatives: OpeningPath[]) {
  const groups = new Map<string, Map<number,string>>();
  if (alternatives.length) for (const candidate of [...alternatives,path]) {
    for (const {version} of candidate.turns) {
      if (!version) continue;
      const choices = groups.get(version.group) ?? new Map<number,string>();
      choices.set(version.number,candidate.pathId); groups.set(version.group,choices);
    }
  }
  return new Map([...groups].map(([group,values]) => [group,[...values].sort(([a],[b])=>a-b).map(([number,id])=>({number,id}))]));
}
export function archivedVersions(archive: OpeningArchive, version: MessageVersion) {
  return openingVersionIndex(archive.path,archive.alternatives).get(version.group) ?? [];
}
export function linkOpeningProjects(archive: OpeningArchive) {
  const paths = [...archive.alternatives,archive.path];
  for (const path of paths) if (path.projectId)
    saveOpeningArchive(path.projectId,{path,alternatives:paths.filter(item => item.pathId !== path.pathId)});
}
function activate(path: OpeningPath, alternatives: OpeningPath[]) {
  update({ ...path, projectId: path.projectId, alternatives, generation: useOpening.getState().generation + 1, busy: null, preview: "", error: "" });
}
export async function switchOpening(pathId: string) {
  if (useOpening.getState().busy === "upload") return;
  stopOpening();
  const state = useOpening.getState(), next = state.alternatives.find(path => path.pathId === pathId);
  if (!next) return;
  if (next.projectId) {
    linkOpeningProjects({path:pathOf(state),alternatives:state.alternatives});
    await openListedProject(next.projectId);
    return;
  }
  activate(next, [...state.alternatives.filter(path => path !== next), pathOf(state)]);
}
export async function revisitOpening(archive: OpeningArchive, path: OpeningPath, edit?: {index:number;text:string}) {
  if (!await navigate("/")) return;
  stopOpening();
  const paths = [...archive.alternatives,archive.path];
  activate(path, paths.filter(item => item.pathId !== path.pathId));
  if (edit) await editOpening(edit.index,edit.text,true);
}
export async function editOpening(index: number, text: string, fresh: boolean) {
  const initial = useOpening.getState(), original = initial.turns[index], value = text.trim();
  if (initial.busy === "upload" || !original?.version || !value || value.length > 1000 || value === original.text) return;
  stopOpening();
  const state = useOpening.getState(), prefix = state.turns.slice(0, index);
  const lastReply = prefix.findLast(turn => turn.role === "assistant");
  const brief = lastReply?.brief ?? {
    request: prefix.filter(turn => turn.role === "user" && !turn.delivery).reduce((acc, turn) => mergedRequest(acc, turn.text), ""),
    intent: selectionRequested(prefix, false) ? "select" : "undecided",
    question: lastReply && /[?？]$/u.test(lastReply.text) ? { prompt: lastReply.text, options: [] } : null,
  } satisfies Brief;
  const choices = archivedVersions({path:pathOf(state),alternatives:state.alternatives}, original.version);
  activate({ ...brief, turns: prefix, pathId: crypto.randomUUID() }, [...state.alternatives, pathOf(state)]);
  await submitOpening(value, fresh, [], true, { group: original.version.group, number: (choices.at(-1)?.number ?? 1) + 1 });
}
export function figureHandoff(before: Brief, complete: OpeningTurn[], text: string, assetCount: number) {
  const context = text ? [...complete,{role:"user" as const,text}] : complete;
  const select = selectionRequested(context, before.intent === "select", assetCount);
  const goal = mergedRequest(before.request, text);
  const curate = requestsCuration(text || before.request, assetCount);
  const hasBrief = complete.some(turn => turn.role === "assistant");
  const clauses = text.split(/[,，。；;\n]+/u).filter(part => part.trim());
  // When the author closes selection, their latest instructions take precedence over the earlier shortlist brief.
  const arranging = hasBrief && !select && clauses.some(part => allImagesClause(part, assetCount));
  const previousLayout = arranging ? authorLayout(complete).split("，").filter(Boolean) : [];
  const alreadyHasWidth = clauses.some(part => Boolean(figureWidth(part)));
  const retained = previousLayout.filter(part => !text.includes(part) &&
    !(alreadyHasWidth && /^(?:整张宽|figure width)/iu.test(part)));
  const instruction = arranging ? [...retained, text].join("，") : goal;
  return {instruction, select, curate, layout:authorLayout(context), goal:arranging ? goal : undefined};
}
export async function submitOpening(raw: string, fresh: boolean, withFiles?: File[], preserveDraft = false, edited?: MessageVersion) {
  const before = useOpening.getState(), text = raw.trim(), files = withFiles ?? before.files;
  if (before.busy || (!text && !files.length)) return;
  const ticket = ++epoch, model = preferredReadingMode();
  const previous = before.turns.at(-1);
  const retrying = !edited && previous?.delivery && previous.text === text;
  const history = retrying ? before.turns.slice(0, -1) : before.turns;
  const author: ChatTurn = { role: "user", text, version: edited ?? (retrying ? previous.version : undefined) ?? { group: crypto.randomUUID(), number: 1 } };
  const complete = history.filter(turn => !turn.delivery).map(({ role, text }) => ({ role, text }));
  const context = text ? [...complete, { role: "user" as const, text }] : complete;
  const nextDraft = edited || (preserveDraft && before.draft.trim() !== text) ? before.draft : "";

  if (files.length) {
    update({ turns: text ? [...history, author] : history, draft: nextDraft, busy: "upload", error: "", preview: "" });
    try {
      await ensureEditorFonts();
      if (ticket !== epoch) return;
      const {instruction,select,curate,layout,goal} = figureHandoff(before,complete,text,files.length);
      const done = await startWithWish(files, instruction, fresh, model, {
        turns: context.map(item => item.role === "assistant" ? "PanelStudio · " + item.text : item.text),
        select, curate:curate && model === "thumbnails", layout, goal,
        archive: { path:{...pathOf(before),turns:history.filter(turn => !turn.delivery)}, alternatives:before.alternatives },
        attachedTurn:Boolean(text), previousGoal:before.request,
      });
      if (ticket !== epoch) return;
      if (done) {
        const archive = useWish.getState().opening;
        if (archive) linkOpeningProjects(archive);
        resetOpening();
      }
      else update({ ...before, busy: null, error: tr("assets.partial") });
    } catch (error) {
      if (ticket === epoch) update({ ...before, busy: null, error: errorText(error) });
    }
    return;
  }

  const controller = new AbortController();
  pendingReply = controller;
  update({ turns: [...history, { ...author, delivery: "pending" }], draft: nextDraft, busy: "reply", preview: "", error: "" });
  try {
    const result = model === "local" ? offlineOpening(text, before) : await api.discussBrief({
      locale: useWorkspace.getState().locale, turns: context.slice(-12), brief: before.request,
      configRevision: cachedReadingProvider()!.configRevision,
    }, controller.signal, preview => {
      if (ticket === epoch) useOpening.setState({ preview });
    });
    if (ticket !== epoch) return;
    const brief: Brief = { request: result.kind === "ready" && context.length === 1 ? text : result.request,
      intent: result.intent, question: result.kind === "question" ? { prompt: result.reply, options: result.options } : null };
    update({ ...brief, turns: [...history, author, { role: "assistant", text: result.reply, brief }], busy: null, preview: "" });
  } catch (error) {
    if (ticket !== epoch) return;
    const message = errorText(error);
    update({ turns: [...history, { ...author, delivery: "failed", error: message, partial: useOpening.getState().preview }],
      draft: edited ? useOpening.getState().draft : useOpening.getState().draft || text, busy: null, preview: "" });
  } finally {
    if (pendingReply === controller) pendingReply = undefined;
  }
}
