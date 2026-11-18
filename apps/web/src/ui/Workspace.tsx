import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { NUDGE_MM } from "@panelstudio/contracts";
import { api } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { workspaceMode, sidebarWidth } from "../model/chrome";
import { geometryLocked, panelIdsOf } from "../model/document-ui";
import { fitCamera } from "../model/view";
import {
  cancelCrop,
  cancelNudge,
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
  selectAll,
  undo,
} from "../state/session";
import { patch, useWorkspace, useWorkspaceFields } from "../state/store";
import { baseDocument } from "../state/types";
import { CanvasStage } from "./CanvasStage";
import { labelName } from "../model/changes";
import { cancelGesture } from "./gesture";
import { labelDiagnostics } from "@panelstudio/core/labels";
import { Inspector } from "./Inspector";
import { LeftSidebar } from "./LeftSidebar";
import { Toolbar } from "./Toolbar";
import { StartScreen } from "./StartScreen";
import { Button } from "./widgets";

export function Workspace({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspaceFields(
    "confirmed", "mode", "leftOpen", "rightOpen", "leftWidth", "rightWidth", "booting", "draggingFiles", "liveMessage",
  );
  const drawerSide = state.confirmed && (state.mode === "drawer" || state.mode === "phone")
    ? state.leftOpen ? "assets" : state.rightOpen ? "inspector" : null : null;
  const overlayDrawer = Boolean(drawerSide) && state.mode === "drawer";
  useEffect(() => {
    if (!active || !drawerSide) return;
    const trigger = document.querySelector<HTMLButtonElement>('[data-action="drawer-' + drawerSide + '"]');
    document.getElementById("studio-" + drawerSide)?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({preventScroll:true});
    return () => { if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({preventScroll:true}); };
  }, [drawerSide, active]);
  useEffect(() => {
    if (!active) return;
    const onResize = () => patch({ mode: workspaceMode(window.innerWidth) });
    onResize();
    window.addEventListener("resize", onResize);
    const onDragEnter = (event: DragEvent) => {
      if (useWorkspace.getState().dialog === "guided") return;
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) patch({ draggingFiles: true });
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) patch({ draggingFiles: false });
    };
    const onDrop = (event: DragEvent) => {
      if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
      event.preventDefault();
      patch({ draggingFiles: false });
      if (useWorkspace.getState().dialog === "guided") return;
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
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") return;
      const current = useWorkspace.getState();
      if (current.dialog || event.defaultPrevented) return;
      if (event.key === "Escape" && (current.leftOpen || current.rightOpen) &&
        (current.mode === "drawer" || current.mode === "phone")) {
        patch({ leftOpen: false, rightOpen: false }); return;
      }
      if (event.key === " " && !isTyping(event.target) && !event.repeat) {
        patch({ spacePan: true });
        event.preventDefault();
        return;
      }
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (event.key === "Escape" && cancelGesture()) { event.preventDefault(); return; }
      if (event.key === "Escape" && current.interaction) { cancelNudge(); event.preventDefault(); return; }
      if (current.compareMode !== "editing" && (["delete", "backspace", "c"].includes(key) || (command && key === "g"))) return;
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
        if (!documentState || current.crop || current.compareMode !== "editing") return;
        const step = event.shiftKey ? NUDGE_MM.shiftStep : NUDGE_MM.step;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const ids = panelIdsOf(current.selection, documentState);
        if (current.selection.kind !== "label" && ids.some((id) => geometryLocked(documentState, id) === "lock")) {
          patch({ liveMessage: t("errors.LOCKED_ELEMENT") }); return;
        }
        queueNudge(ids, dx, dy, current.selection.kind === "label" ? "label" : "panels");
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
  }, [active]);

  const left = sidebarWidth("left", state.mode, state.leftWidth);
  const right = sidebarWidth("right", state.mode, state.rightWidth);
  return (
    <div className="app" data-testid="workspace" data-editor={Boolean(state.confirmed)}>
      <Toolbar inert={overlayDrawer} />
      <div className={"workspace" + (state.confirmed ? "" : " home-workspace")}>
        <div className="editor-panes" data-open-panel={drawerSide ?? undefined} hidden={!state.confirmed}>
          <LeftSidebar />
          {state.mode === "full" ? <Divider side="left" width={left} /> : <div className="divider" />}
          <div className="canvas-column" inert={overlayDrawer}>
            {state.confirmed && <><Banners /><CanvasStage /></>}
          </div>
          {state.mode === "full" ? <Divider side="right" width={right} /> : <div className="divider" />}
          <Inspector />
          {overlayDrawer &&
            <button className="drawer-backdrop" type="button" tabIndex={-1} data-action="close-drawer" aria-label={t("a11y.close")}
              onClick={() => patch({ leftOpen: false, rightOpen: false })} />}
        </div>
        {!state.confirmed && <><Banners />{state.booting ? <p className="start-loading" role="status">{t("app.opening")}</p> : <StartScreen />}</>}
        {state.draggingFiles ? <div className="drop-overlay">{t("assets.drop")}</div> : null}
      </div>
      {state.confirmed && <footer className="bottombar">
        <span>{t("status.panels", { count: state.confirmed?.document.panelOrder.length ?? 0 })}</span>
      </footer>}
      {state.confirmed && <nav className="mobile-workspace-nav" aria-label={t("toolbar.more")}>
        <Button action="mobile-assets" variant="quiet" onClick={() => patch({ assetTab: "assets", leftOpen: true, rightOpen: false })}>{t("assets.tab")}</Button>
        <Button action="mobile-panels" variant="quiet" onClick={() => patch({ assetTab: "panels", leftOpen: true, rightOpen: false })}>{t("panels.tab")}</Button>
        <Button action="mobile-properties" variant="quiet" onClick={() => patch({ inspectorMode: "properties", rightOpen: true, leftOpen: false })}>{t("inspector.tab")}</Button>
        <Button action="mobile-refine" variant="quiet" onClick={() => patch({ inspectorMode: "ai", rightOpen: true, leftOpen: false })}>{t("ai.tab")}</Button>
      </nav>}
      <div className="sr-only" aria-live="polite" data-testid="live">{state.liveMessage}</div>
    </div>
  );
}

function Banners() {
  const { t } = useTranslation();
  const state = useWorkspaceFields("projectId", "backend", "saveState");
  const assets = useQuery({
    queryKey: ["assets", state.projectId],
    enabled: Boolean(state.projectId),
    queryFn: () => api.assets(state.projectId ?? ""),
  });
  const art = useWorkspace(baseDocument);
  const missing = (assets.data?.items ?? []).flatMap((asset) => asset.diagnostics.filter((item) => item.code === "FONT_MISSING"));
  const labelIssues = art ? labelDiagnostics(art) : [];
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
      {labelIssues.length + missing.length > 0 && <details className="banner quiet artwork-notices"><summary>{t("status.artworkNotices", { count: labelIssues.length + missing.length })}</summary>
        {labelIssues.map((issue, index) => <p key={`label-${index}`}>{issue.panelIds?.map((id) => art ? labelName(art, id) : "").join(", ")} · {formatDiagnostic(t, issue)}</p>)}
        {missing.map((item, index) => <p key={`font-${index}`}>{t("status.fontMissing")} · {formatDiagnostic(t, item)}</p>)}
      </details>}
    </div>
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
