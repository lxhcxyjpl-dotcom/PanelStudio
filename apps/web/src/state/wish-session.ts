import { create } from "zustand";
import type { OpeningArchive } from "./opening";
import type { VersionRef } from "./message-versions";
import type { FigureCuration, FigureDiscussionReply, FigureReading, PublicationContext } from "@panelstudio/contracts";
import type { ProposalChange } from "../model/changes";
import type { Confirmed } from "./types";
import { enUS, zhCN } from "../i18n/catalog";

export type ReadingMode = "local" | "text" | "thumbnails";
export type CuratedSwap = { panelId: string; assetId: string; revision: number };
export type Curation = { asked: boolean };
export const beginCuration = (): Curation => ({ asked: false });
export type IdentityQuestion = {
  id: string;
  filename: string;
  fingerprint: string;
  nameQuote: string;
  imageQuote: string;
  remaining: number;
  swap?: CuratedSwap;
  resume: {
    text: string;
    action: "say" | "draft";
    model: ReadingMode;
    revision: number;
    configRevision?: number;
  } | null;
};
type Phase = "draft" | "brief" | "select" | "editing";
type IdentityAnswer = { id:string; fingerprint:string } & NonNullable<FigureReading["decision"]>;
export type WishEditFeedback = Pick<Confirmed, "revision" | "documentHash"> & {
  changed: boolean;
  changes: ProposalChange[];
  focusPanelId?: string;
};

export function isCurrentWishEdit(edit: WishEditFeedback | null, confirmed: Confirmed | null): edit is WishEditFeedback {
  return Boolean(edit && confirmed && edit.revision === confirmed.revision && edit.documentHash === confirmed.documentHash);
}

export type WishCheckpoint = {
  version: VersionRef; source: string; revision: number; assets: string[]; panelIds: string[]; identities: IdentityAnswer[];
  action: "say" | "draft"; aiJob?: string; fileTurn?: boolean;
  before: Pick<WishSession, "phase" | "goal" | "layout" | "selected" | "order" | "rows" | "reasons" | "notes" | "reply" | "question" | "curation"> &
    Partial<Pick<WishSession, "layoutRecovery" | "focusChoice">>;
};
export type WishSession = {
  projectId: string | null;
  phase: Phase;
  input: string;
  goal: string;
  layout: string;
  selected: string[];
  order: string[];
  rows: string[][];
  reasons: Record<string, string>;
  curation: Curation | null;
  layoutRecovery: { curation: FigureCuration | null } | null;
  readings: Record<string, FigureReading>;
  evidence: Record<string, { evidence: string; ignoreName: boolean }>;
  identity: IdentityQuestion | null;
  question: { prompt: string; options: string[]; jobId?: string } | null;
  focusChoice: { revision: number; goal: string; proposal: FigureDiscussionReply } | null;
  notes: Record<string, string>;
  reviewNotes: Record<string, string> | null;
  reply: string;
  replyRevision: number | null;
  editFeedback: WishEditFeedback | null;
  turns: string[];
  checkpoints: Record<number, WishCheckpoint>;
  identities: Record<string, IdentityAnswer>;
  opening: OpeningArchive | null;
  busy: boolean;
  canStopDiscussion: boolean;
};
const empty = (): WishSession => ({
  projectId: null,
  phase: "draft",
  input: "",
  goal: "",
  layout: "",
  selected: [],
  order: [],
  rows: [],
  reasons: {},
  curation: null,
  layoutRecovery: null,
  readings: {},
  evidence: {},
  identity: null,
  question: null,
  focusChoice: null,
  notes: {},
  reviewNotes: null,
  reply: "",
  replyRevision: null,
  editFeedback: null,
  turns: [], checkpoints: {}, identities: {}, opening: null,
  busy: false, canStopDiscussion: false,
});
export const useWish = create<WishSession>(empty);
function key(id: string) {
  return "panelstudio.figure-wish." + id;
}
const seeded = new Map<string, WishSession>();
export function seedWish(project: string, changes: Partial<WishSession>) {
  const state = { ...empty(), ...changes, projectId: project };
  seeded.set(project, state);
  try { localStorage.setItem(key(project),JSON.stringify(state)); } catch { /* openWish also consumes the memory copy. */ }
}
export function saveOpeningArchive(project: string, opening: OpeningArchive) {
  if (useWish.getState().projectId === project) { changeWish({opening}); return; }
  try {
    const raw = localStorage.getItem(key(project));
    if (raw) localStorage.setItem(key(project),JSON.stringify({...JSON.parse(raw),opening}));
  } catch { /* The independent project itself remains available. */ }
}
export function openWish(id: string | null, hasPanels = false) {
  let initial = empty();
  if (hasPanels) initial.phase = "editing";
  if (id)
    try {
      const saved = JSON.parse(localStorage.getItem(key(id)) ?? "null") as WishSession | null;
      if (
        saved?.projectId === id &&
        Array.isArray(saved.selected) &&
        Array.isArray(saved.order) &&
        Array.isArray(saved.turns) && saved.turns.every(turn => typeof turn === "string") &&
        saved.notes &&
        ["draft", "brief", "select", "editing"].includes(saved.phase)
      ) {
        initial = { ...initial, ...saved };
        const retired = [enUS, zhCN].flatMap(messages =>
          [messages["wish.askBrief"], messages["wish.askFocus"], messages["wish.askStory"]]);
        const prompt = initial.question?.jobId ? undefined : initial.question?.prompt;
        if (prompt && retired.includes(prompt)) {
          initial.question = null;
          if (initial.reply === prompt) initial.reply = "";
        }
        if (initial.phase === "brief") initial.phase = "draft";
      }
    } catch {
      /* A fresh session still has the saved figure and library. */
    }
  if (id && seeded.has(id)) { initial = seeded.get(id)!; seeded.delete(id); }
  useWish.setState({ ...initial, projectId: id, busy: false, canStopDiscussion: false, reviewNotes: null }, true);
}
export function changeWish(change: Partial<Omit<WishSession, "projectId">>) {
  useWish.setState("reply" in change ? { replyRevision: null, ...change } : change);
  const state = useWish.getState();
  if (state.projectId)
    try {
      localStorage.setItem(key(state.projectId), JSON.stringify({
        ...state, readings: {}, busy: false, canStopDiscussion: false, reviewNotes: null,
      }));
    } catch {
      /* Storage can be disabled. */
    }
}
export function lastPublication(): Pick<PublicationContext, "journal" | "field"> {
  try {
    const p = JSON.parse(localStorage.getItem("panelstudio.last-publication") ?? "{}");
    return {
      journal: typeof p.journal === "string" ? p.journal : "",
      field: typeof p.field === "string" ? p.field : "",
    };
  } catch {
    return { journal: "", field: "" };
  }
}
export function rememberPublication(p: PublicationContext) {
  try {
    localStorage.setItem(
      "panelstudio.last-publication",
      JSON.stringify({ journal: p.journal, field: p.field }),
    );
  } catch {
    /* Optional on this device. */
  }
}
