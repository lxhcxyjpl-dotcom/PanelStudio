import { ENGINE_VERSIONS, type AIHistoryTurn, type AIEditScope, type Candidate, type Diagnostic, type DomainCommand, type FigureDocumentV1, type LayoutRequest } from "@panelstudio/contracts";
import type { Guide } from "../model/snap";
import type { Camera } from "../model/view";
import type { LocaleName, MotionPreference, ThemeName } from "../prefs";

export type Selection =
  | { kind: "none" }
  | { kind: "panels"; ids: string[] }
  | { kind: "label"; panelId: string }
  | { kind: "group"; groupId: string };

export type Confirmed = {
  revision: number;
  document: FigureDocumentV1;
  documentHash: string;
  history: { canUndo: boolean; canRedo: boolean };
};

export type PendingDraft = {
  baseRevision: number;
  commands: DomainCommand[];
  document: FigureDocumentV1;
  idempotencyKey: string;
  reason: "network" | "conflict" | "server";
};

export type ImportRow = {
  id: string;
  filename: string;
  status: "importing" | "ready" | "failed";
  message: string | null;
  code: string | null;
};

export type LayoutCard = {
  candidate: Candidate;
  previewUrl: string | null;
  previewError: string | null;
};

export type ExportState =
  | null
  | { status: "running"; revision: number; phase: string }
  | {
      status: "ready";
      revision: number;
      artifactId: string;
      filename: string;
      diagnostics: Diagnostic[];
      format: string;
    }
  | { status: "failed"; message: string };

export type DialogName = null | "settings" | "ai-settings" | "shortcuts" | "export" | "svg" | "asset" | "recovery" | "quota" | "guided" | "publication" | "onboarding";

export type QuotaChoice = { assetIds: string[]; remaining: number };

export type HistoryRetry = {
  direction: "undo" | "redo";
  baseRevision: number;
  idempotencyKey: string;
};

export type AiStatus =
  | { phase: "idle" }
  | { phase: "running"; jobId: string | null; label: string; prompt: string; frozen: FrozenScope; baseRevision: number }
  | { phase: "clarification"; question: string; options: string[] }
  | { phase: "unsupported"; reason: string }
  | { phase: "failed"; code: string; message: string }
  | { phase: "cancelled" };

export type FrozenScope = { scope: AIEditScope; selectedPanelIds: string[] };
export type AwaitingAnswer = FrozenScope & { jobId: string; baseRevision: number; question: string; options: string[] };

export type WorkspaceState = {
  compareMode: "editing" | "original" | "draft";
  candidateRoot: { revision: number; document: FigureDocumentV1 } | null;
  aiHistory: AIHistoryTurn[];
  historyCursor: string | null;
  aiScope: AIEditScope;
  scopeChanged: boolean;
  frozenScope: FrozenScope | null;
  awaitingAnswer: AwaitingAnswer | null;
  aiPrompt: string;
  marquee: { x: number; y: number; width: number; height: number } | null;
  theme: ThemeName;
  locale: LocaleName;
  motion: MotionPreference;
  reduceTransparency: boolean;
  leftWidth: number;
  rightWidth: number;
  mode: "full" | "compact" | "drawer" | "phone";
  leftOpen: boolean;
  rightOpen: boolean;
  projectId: string | null;
  title: string;
  confirmed: Confirmed | null;
  draft: PendingDraft | null;
  optimistic: FigureDocumentV1 | null;
  interaction: FigureDocumentV1 | null;
  guides: Guide[];
  guidesFading: boolean;
  crop: { panelId: string; crop: { x: number; y: number; width: number; height: number } } | null;
  saveState: "idle" | "saving" | "saved" | "failed" | "offline" | "conflict";
  selection: Selection;
  camera: Camera;
  viewport: { width: number; height: number };
  fittedProjectId: string | null;
  cards: LayoutCard[];
  cardLayoutRequest: LayoutRequest | null;
  activeCandidateId: string | null;
  layoutState: "idle" | "loading" | "conflict" | "error";
  layoutMessage: string | null;
  imports: ImportRow[];
  draggingFiles: boolean;
  dialog: DialogName;
  assetInfoId: string | null;
  quota: QuotaChoice | null;
  exportState: ExportState;
  backend: "unknown" | "ok" | "down";
  booting: boolean;
  startMessage: string;
  liveMessage: string;
  spacePan: boolean;
  dragging: boolean;
  historyRetry: HistoryRetry | null;
  serverSnapshot: Confirmed | null;
  aiStatus: AiStatus;
};

export function baseDocument(state: WorkspaceState): FigureDocumentV1 | null {
  return state.draft?.document ?? state.optimistic ?? state.confirmed?.document ?? null;
}

export function candidatesStale(state: WorkspaceState): boolean {
  const base = state.cards[0]?.candidate.baseRevision;
  if (base === undefined || !state.confirmed) return false;
  return base !== state.confirmed.revision || state.draft !== null || state.cards.some(({ candidate }) =>
    candidate.engineVersion !== ENGINE_VERSIONS.layout || candidate.fontRegistryVersion !== ENGINE_VERSIONS.fontRegistry);

}
