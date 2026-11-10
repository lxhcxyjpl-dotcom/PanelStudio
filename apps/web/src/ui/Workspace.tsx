import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { NUDGE_MM } from "@panelstudio/contracts";
import { BUNDLED_FONTS } from "@panelstudio/contracts";
import { workspaceMode, sidebarWidth, localizedSummary } from "../model/chrome";
import { geometryLocked, panelIdsOf } from "../model/document-ui";
import { fitCamera } from "../model/view";
import {
  acceptCandidate,
  boot,
  cancelCrop,
  commitCrop,
  continueEditing,
  createGroup,
  deleteSelection,
  dismissCandidates,
  dissolveGroup,
  enterCrop,
  importFiles,
  queueNudge,
  redo,
  requestLayout,
  selectAll,
  selectCandidate,
  undo,
} from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { baseDocument, candidatesStale } from "../state/types";
import { CanvasStage } from "./CanvasStage";
import { Dialogs } from "./Dialogs";
import { Inspector } from "./Inspector";
import { LeftSidebar } from "./LeftSidebar";
import { Toolbar } from "./Toolbar";
import { Button } from "./widgets";

export function Workspace() {
  const { t } = useTranslation();
  const state = useWorkspace();
  useEffect(() => {
    void boot();
    const onResize = () => patch({ mode: workspaceMode(window.innerWidth) });
    window.addEventListener("resize", onResize);
    const onDragEnter = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) patch({ draggingFiles: true });
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) patch({ draggingFiles: false });
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      patch({ draggingFiles: false });
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) void importFiles(files);
    };
    const onDragOver = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") return;
      const current = useWorkspace.getState();
      if (event.key === " " && !isTyping(event.target) && !event.repeat) {
        patch({ spacePan: true });
        event.preventDefault();
        return;
      }
      if (current.dialog) return;
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (command && key === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if (command && key === "a" && document.activeElement?.closest("[data-testid=canvas]")) {
        event.preventDefault();
        selectAll();
        return;
      }
      if (command && key === "g") {
        event.preventDefault();
        const documentState = baseDocument(current);
        if (event.shiftKey && current.selection.kind === "group") void dissolveGroup(current.selection.groupId);
        else if (!event.shiftKey && documentState) void createGroup();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (current.crop) cancelCrop();
        else if (current.cards.length > 0) dismissCandidates();
        else patch({ selection: { kind: "none" } });
        return;
      }
      if (event.key === "Enter" && current.crop) {
        event.preventDefault();
        void commitCrop();
        return;
      }
      if (event.key === "?" ) {
        patch({ dialog: "shortcuts" });
        return;
      }
      if (!command && key === "v") {
        patch({ crop: null });
        return;
      }
      if (!command && key === "c") {
        const documentState = baseDocument(current);
        const panelId = current.selection.kind === "panels" && current.selection.ids.length === 1 ? current.selection.ids[0] : undefined;
        if (documentState && panelId) enterCrop(panelId);
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteSelection();
        return;
      }
      if (event.code === "Digit1" && event.shiftKey && !command) {
        event.preventDefault();
        const documentState = baseDocument(current);
        if (!documentState) return;
        patch({ camera: fitCamera(current.viewport, { width: documentState.canvas.widthMm, height: documentState.canvas.heightMm }) });
        return;
      }
      if (event.code === "Digit0" && event.shiftKey && !command) {
        event.preventDefault();
        patch({ camera: { ...current.camera, zoom: 1 } });
        return;
      }
      if ((event.key === "+" || event.key === "=" || event.key === "-") && !command) {
        event.preventDefault();
        const factor = event.key === "-" ? 1 / 1.1 : 1.1;
        const origin = { x: current.viewport.width / 2, y: current.viewport.height / 2 };
        const zoom = Math.min(4, Math.max(0.1, current.camera.zoom * factor));
        const worldX = (origin.x - current.camera.panX) / current.camera.zoom;
        const worldY = (origin.y - current.camera.panY) / current.camera.zoom;
        patch({ camera: { zoom, panX: origin.x - worldX * zoom, panY: origin.y - worldY * zoom } });
        return;
      }
      if (event.key.startsWith("Arrow") && !command) {
        const list = event.target instanceof HTMLElement && event.target.closest("[data-keys=list]");
        if (list) return;
        event.preventDefault();
        const documentState = baseDocument(current);
        if (!documentState || current.crop || (current.activeCandidateId && !candidatesStale(current))) return;
        const step = event.shiftKey ? NUDGE_MM.shiftStep : NUDGE_MM.step;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const ids = panelIdsOf(current.selection, documentState);
        if (current.selection.kind === "label") return;
        if (ids.some((id) => geometryLocked(documentState, id) === "lock")) return;
        queueNudge(ids, dx, dy);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") patch({ spacePan: false });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const left = sidebarWidth("left", state.mode, state.leftWidth);
  const right = sidebarWidth("right", state.mode, state.rightWidth);
  const stale = candidatesStale(state);
  return (
    <div className="app" data-testid="workspace" onDragEnter={() => patch({ draggingFiles: true })}>
      <Toolbar />
      <div className="workspace">
        <LeftSidebar />
        {state.mode === "full" ? <Divider side="left" width={left} /> : <div className="divider" />}
        <div className="canvas-column">
          <Banners />
          <CanvasStage />
          <CandidateDock />
        </div>
        {state.mode === "full" ? <Divider side="right" width={right} /> : <div className="divider" />}
        <Inspector />
        {state.draggingFiles ? <div className="drop-overlay">{t("assets.drop")}</div> : null}
      </div>
      <footer className="bottombar">
        <span>{t("status.zoom", { zoom: Math.round(state.camera.zoom * 100) })}</span>
        <span>{t("status.panels", { count: state.confirmed?.document.panelOrder.length ?? 0 })}</span>
        <span className="font-warning" title={t("status.fontMissing", { families: BUNDLED_FONTS.map((font) => font.family).join(", ") })}>
          FONT_MISSING
        </span>
        {stale ? <span>{state.cards.some((card) => card.candidate.origin === "ai") ? t("ai.stale") : t("layout.stale")}</span> : null}
      </footer>
      <div className="sr-only" aria-live="polite" data-testid="live">{state.liveMessage}</div>
      <Dialogs />
    </div>
  );
}

function Banners() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const families = BUNDLED_FONTS.map((font) => font.family).join(", ");
  return (
    <div className="banners">
      {state.backend === "down" || state.saveState === "offline" ? <p className="banner">{t("save.offline")}</p> : null}
      {state.saveState === "failed" ? (
        <p className="banner">
          {t("save.failed")}
          <Button action="banner-retry" onClick={() => patch({ dialog: "recovery" })}>{t("save.retry")}</Button>
        </p>
      ) : null}
      {state.saveState === "conflict" ? <p className="banner">{t("save.conflict")}</p> : null}
      {state.layoutState === "conflict" || state.layoutState === "error" ? <p className="banner">{state.layoutMessage}</p> : null}
      {state.layoutState === "loading" ? <p className="banner">{t("layout.loading")}</p> : null}
      {candidatesStale(state) ? (
        <p className="banner">
          {state.cards.some((card) => card.candidate.origin === "ai") ? t("ai.stale") : t("layout.stale")}
          {state.cards.some((card) => card.candidate.origin === "ai") ? null : (
            <Button action="regenerate-layout" onClick={() => void requestLayout()}>{t("layout.regenerate")}</Button>
          )}
        </p>
      ) : null}
      <p className="banner quiet">{t("status.fontMissing", { families })}</p>
    </div>
  );
}

function CandidateDock() {
  const { t, i18n } = useTranslation();
  const state = useWorkspace();
  if (state.cards.some((card) => card.candidate.origin === "ai")) return null;
  if (state.cards.length === 0 && state.layoutState === "idle") return null;
  const stale = candidatesStale(state);
  const applyReason = !state.activeCandidateId ? t("layout.pick") : stale ? t("layout.stale") : undefined;
  return (
    <section className="candidates" aria-label={t("layout.preview")} data-keys="candidates">
      <header>
        <strong>{t("layout.preview")}</strong>
        <Button action="apply-layout" variant="primary" disabledReason={applyReason} onClick={() => void acceptCandidate()}>{t("layout.apply")}</Button>
        <Button action="cancel-layout" onClick={dismissCandidates}>{t("layout.cancel")}</Button>
        <Button action="manual-edit" onClick={continueEditing}>{t("layout.manual")}</Button>
      </header>
      <div className="candidate-row">
        {state.cards.map((card) => {
          const canvas = card.candidate.previewDocument.canvas;
          const active = card.candidate.id === state.activeCandidateId;
          return (
            <button
              key={card.candidate.id}
              type="button"
              data-action="select-candidate"
              data-testid="candidate-card"
              className={active ? "candidate active" : "candidate"}
              onClick={() => selectCandidate(card.candidate.id)}
            >
              {card.previewUrl ? <img alt="" src={card.previewUrl} /> : <span>{card.previewError ?? t("layout.loading")}</span>}
              <strong>{localizedSummary(card.candidate.summary, i18n.language)}</strong>
              <span>{t("layout.canvasSize", { width: round(canvas.widthMm), height: round(canvas.heightMm) })}</span>
              {card.candidate.diagnostics.map((item, index) => <em key={`${item.code}-${index}`}>{item.code}</em>)}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Divider({ side, width }: { side: "left" | "right"; width: number }) {
  const { t } = useTranslation();
  return (
    <div className="divider">
      <button
        type="button"
        data-action={`resize-${side}`}
        className="divider-hit"
        aria-label={side === "left" ? t("a11y.resizeLeft") : t("a11y.resizeRight")}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowLeft" ? -8 : event.key === "ArrowRight" ? 8 : 0;
          if (!delta) return;
          event.preventDefault();
          if (side === "left") patch({ leftWidth: sidebarWidth("left", "full", width + delta) });
          else patch({ rightWidth: sidebarWidth("right", "full", width + (event.key === "ArrowLeft" ? 8 : -8)) });
        }}
        onPointerDown={(event) => {
          const start = event.clientX;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const move = (ev: PointerEvent) => {
            const delta = ev.clientX - start;
            if (side === "left") patch({ leftWidth: sidebarWidth("left", "full", width + delta) });
            else patch({ rightWidth: sidebarWidth("right", "full", width - delta) });
          };
          const end = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", end);
            target.removeEventListener("pointercancel", end);
          };
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", end);
          target.addEventListener("pointercancel", end);
        }}
      />
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
