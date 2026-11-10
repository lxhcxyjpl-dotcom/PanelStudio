import { create } from "zustand";
import { i18n } from "../i18n";
import { workspaceMode } from "../model/chrome";
import { readPrefs, writePrefs, type Preferences } from "../prefs";
import type { WorkspaceState } from "./types";

const prefs = readPrefs();

export const useWorkspace = create<WorkspaceState>(() => ({
  ...prefs,
  mode: workspaceMode(typeof window === "undefined" ? 1440 : window.innerWidth),
  leftOpen: false,
  rightOpen: false,
  projectId: null,
  title: "",
  confirmed: null,
  draft: null,
  optimistic: null,
  interaction: null,
  guides: [],
  guidesFading: false,
  crop: null,
  saveState: "idle",
  selection: { kind: "none" },
  camera: { zoom: 1, panX: 40, panY: 40 },
  viewport: { width: 800, height: 600 },
  fittedProjectId: null,
  cards: [],
  activeCandidateId: null,
  layoutState: "idle",
  layoutMessage: null,
  imports: [],
  draggingFiles: false,
  dialog: null,
  assetInfoId: null,
  quota: null,
  exportState: null,
  backend: "unknown",
  booting: true,
  liveMessage: "",
  spacePan: false,
  dragging: false,
  historyRetry: null,
  serverSnapshot: null,
}));

export function patch(partial: Partial<WorkspaceState>): void {
  useWorkspace.setState(partial);
}

export function preferencesOf(state: WorkspaceState): Preferences {
  return {
    theme: state.theme,
    locale: state.locale,
    motion: state.motion,
    reduceTransparency: state.reduceTransparency,
    leftWidth: state.leftWidth,
    rightWidth: state.rightWidth,
  };
}

export function syncChrome(state: WorkspaceState): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = state.theme;
  root.lang = state.locale;
  const reduced =
    state.motion === "on" ||
    (state.motion === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  root.dataset.reduceMotion = reduced ? "true" : "false";
  root.dataset.reduceTransparency = state.reduceTransparency ? "true" : "false";
  if (i18n.language !== state.locale) void i18n.changeLanguage(state.locale);
  writePrefs(preferencesOf(state));
}

syncChrome(useWorkspace.getState());

useWorkspace.subscribe((state, previous) => {
  if (
    state.theme !== previous.theme ||
    state.locale !== previous.locale ||
    state.motion !== previous.motion ||
    state.reduceTransparency !== previous.reduceTransparency ||
    state.leftWidth !== previous.leftWidth ||
    state.rightWidth !== previous.rightWidth
  ) {
    syncChrome(state);
  }
});
