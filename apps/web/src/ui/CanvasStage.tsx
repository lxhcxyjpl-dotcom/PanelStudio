import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { ARTWORK_COLOR_PRESETS, type FigureDocumentV1 } from "@panelstudio/contracts";
import { applyCommands } from "@panelstudio/core/apply";
import { scalePanel, translateSelection } from "@panelstudio/core/arrange";
import { contentPlacement, type FrameAnchor } from "@panelstudio/core/geometry";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { api, contentUrl } from "../api/client";
import { i18n } from "../i18n";
import { geometryLocked, groupForPanel, withCrop } from "../model/document-ui";
import { PX_PER_MM } from "../model/place";
import { boundsOf, snapTranslation, type Guide } from "../model/snap";
import { fitCamera, snapToleranceMm } from "../model/view";
import { assetLookup, openSample, readyViewport, transact } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { baseDocument, candidatesStale, type WorkspaceState } from "../state/types";

export function CanvasStage() {
  const state = useWorkspace();
  useQuery({
    queryKey: ["assets", state.projectId],
    enabled: Boolean(state.projectId),
    queryFn: () => api.assets(state.projectId ?? ""),
  });
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const art = useArt(state);
  const base = baseDocument(state);
  const previewing = Boolean(state.activeCandidateId) && !candidatesStale(state);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      patch({ viewport: { width: node.clientWidth, height: node.clientHeight } });
    });
    observer.observe(node);
    patch({ viewport: { width: node.clientWidth, height: node.clientHeight } });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!art || !state.projectId || state.fittedProjectId === state.projectId) return;
    if (state.viewport.width < 40) return;
    patch({
      camera: fitCamera(state.viewport, { width: art.canvas.widthMm, height: art.canvas.heightMm }),
      fittedProjectId: state.projectId,
    });
  }, [art, state.fittedProjectId, state.projectId, state.viewport]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        const camera = useWorkspace.getState().camera;
        patch({ camera: { ...camera, panX: camera.panX - event.deltaX, panY: camera.panY - event.deltaY } });
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const camera = useWorkspace.getState().camera;
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      const origin = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const zoom = Math.min(4, Math.max(0.1, camera.zoom * factor));
      const worldX = (origin.x - camera.panX) / camera.zoom;
      const worldY = (origin.y - camera.panY) / camera.zoom;
      patch({ camera: { zoom, panX: origin.x - worldX * zoom, panY: origin.y - worldY * zoom } });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  if (!art || !base || !state.projectId) {
    return (
      <div ref={viewportRef} className="canvas-viewport" data-testid="canvas" tabIndex={0}>
        <EmptyCanvas />
      </div>
    );
  }

  const px = PX_PER_MM;
  return (
    <div
      ref={viewportRef}
      className="canvas-viewport"
      data-testid="canvas"
      data-dragging={state.dragging ? "true" : "false"}
      tabIndex={0}
      role="application"
      aria-label={i18n.t("a11y.canvas")}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget && !(event.target instanceof HTMLElement && event.target.dataset.canvasPaper === "true")) return;
        if (state.spacePan) {
          beginPan(event);
          return;
        }
        beginMarquee(event, base);
      }}
    >
      <div
        className="camera"
        style={{ transform: `translate(${state.camera.panX}px, ${state.camera.panY}px) scale(${state.camera.zoom})` }}
      >
        <div
          ref={paperRef}
          className="paper"
          data-canvas-paper="true"
          style={{
            width: art.canvas.widthMm * px,
            height: art.canvas.heightMm * px,
            background: art.canvas.background,
          }}
        >
          {art.stackOrder.map((panelId) => {
            const panel = art.panels[panelId];
            if (!panel) return null;
            const place = placement(panel, panelId);
            const selected = isSelected(state, base, panelId);
            return (
              <div
                key={panelId}
                className="panel-frame"
                data-panel-id={panelId}
                data-frame={`${panel.frameMm.x},${panel.frameMm.y},${panel.frameMm.width},${panel.frameMm.height}`}
                style={{
                  transform: `translate(${panel.frameMm.x * px}px, ${panel.frameMm.y * px}px)`,
                  width: panel.frameMm.width * px,
                  height: panel.frameMm.height * px,
                  boxShadow: selected ? `0 0 0 1px ${ARTWORK_COLOR_PRESETS[1]}, 0 0 0 2px var(--document-paper)` : undefined,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  selectPanel(base, panelId, event.shiftKey);
                  if (event.button !== 0) return;
                  if (state.spacePan) {
                    beginPan(event);
                    return;
                  }
                  if (state.crop) return;
                  if (previewing) {
                    const ai = useWorkspace.getState().cards.some((card) => card.candidate.origin === "ai");
                    patch({ liveMessage: i18n.t(ai ? "ai.previewOnly" : "canvas.previewOnly") });
                    return;
                  }
                  if (geometryLocked(base, panelId)) return;
                  beginMove(event, paperRef.current, base, panelId);
                }}
              >
                {place ? (
                  <img
                    alt=""
                    draggable={false}
                    src={contentUrl(state.projectId!, panel.assetId)}
                    style={{
                      position: "absolute",
                      left: (place.x - panel.frameMm.x) * px,
                      top: (place.y - panel.frameMm.y) * px,
                      width: place.width * px,
                      height: place.height * px,
                    }}
                  />
                ) : null}
                {selected && state.selection.kind === "panels" && state.selection.ids.length === 1 && !state.crop && !geometryLocked(base, panelId) && !previewing
                  ? (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        data-action={`scale-${corner}`}
                        className={`handle corner ${corner}`}
                        aria-label={corner}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginScale(event, paperRef.current, base, panelId, opposite(corner));
                        }}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {art.panelOrder.map((panelId) => {
            const label = resolvePanelLabel(art, panelId);
            if (!label) return null;
            const selected = state.selection.kind === "label" && state.selection.panelId === panelId;
            return (
              <button
                key={`label-${panelId}`}
                type="button"
                data-action="select-label"
                className="label-hit"
                style={{
                  left: label.bounds.x * px,
                  top: label.bounds.y * px,
                  width: Math.max(label.bounds.width, label.fontSizeUser) * px,
                  height: label.bounds.height * px,
                  color: label.color,
                  fontFamily: label.fontFamily,
                  fontSize: label.fontSizeUser * px,
                  fontWeight: label.fontWeight,
                  outline: selected ? `1px solid ${ARTWORK_COLOR_PRESETS[1]}` : undefined,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  patch({ selection: { kind: "label", panelId } });
                }}
              >
                {label.text}
              </button>
            );
          })}
          {state.guides.map((guide) => (
            <div
              key={`${guide.axis}-${guide.mm}`}
              className={state.guidesFading ? "guide fading" : "guide"}
              style={guide.axis === "x" ? { left: guide.mm * px } : { top: guide.mm * px }}
            />
          ))}
          <Margins art={art} />
          {state.crop ? <CropOverlay art={art} panelId={state.crop.panelId} paperRef={paperRef} /> : null}
        </div>
      </div>
      {state.projectId && art.panelOrder.length === 0 ? <EmptyCanvas overlay /> : null}
    </div>
  );
}

function EmptyCanvas({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className={overlay ? "empty-overlay" : "empty-state"}>
      <h2>{i18n.t("app.emptyTitle")}</h2>
      <p>{i18n.t("app.emptyBody")}</p>
      <p>{i18n.t("app.formats")}</p>
      <div className="empty-actions">
        <button type="button" className="button primary" data-action="empty-import" onClick={() => document.getElementById("import-input")?.click()}>
          {i18n.t("toolbar.import")}
        </button>
        <button type="button" className="button" data-action="open-sample" onClick={() => void openSample()}>
          {i18n.t("app.openSample")}
        </button>
      </div>
    </div>
  );
}

function Margins({ art }: { art: FigureDocumentV1 }) {
  const px = PX_PER_MM;
  const { marginsMm, widthMm, heightMm } = art.canvas;
  return (
    <div
      className="margins"
      style={{
        left: marginsMm.left * px,
        top: marginsMm.top * px,
        width: (widthMm - marginsMm.left - marginsMm.right) * px,
        height: (heightMm - marginsMm.top - marginsMm.bottom) * px,
      }}
    />
  );
}

function CropOverlay({
  art,
  panelId,
  paperRef,
}: {
  art: FigureDocumentV1;
  panelId: string;
  paperRef: RefObject<HTMLDivElement | null>;
}) {
  const panel = art.panels[panelId];
  const viewport = readyViewport(panel?.assetId ?? "");
  if (!panel || !viewport) return null;
  const full = contentPlacement(panel.frameMm, panel.cropNormalized, viewport);
  const px = PX_PER_MM;
  const edges = ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as const;
  return (
    <>
      <img
        alt=""
        className="crop-ghost"
        draggable={false}
        src={contentUrl(useWorkspace.getState().projectId ?? "", panel.assetId)}
        style={{ left: full.x * px, top: full.y * px, width: full.width * px, height: full.height * px }}
      />
      {edges.map((edge) => (
        <button
          key={edge}
          type="button"
          data-action={`crop-${edge}`}
          className={`handle crop ${edge}`}
          style={cropHandleStyle(panel.frameMm, edge, px)}
          aria-label={edge}
          onPointerDown={(event) => {
            event.stopPropagation();
            beginCrop(event, paperRef.current, panelId, edge);
          }}
        />
      ))}
    </>
  );
}

function useArt(state: WorkspaceState): FigureDocumentV1 | null {
  return useMemo(() => {
    const base = baseDocument(state);
    if (!base) return null;
    if (state.crop) {
      const panel = base.panels[state.crop.panelId];
      const viewport = panel ? readyViewport(panel.assetId) : null;
      if (panel && viewport) return withCrop(base, state.crop.panelId, state.crop.crop, viewport);
    }
    if (state.interaction) return state.interaction;
    if (state.activeCandidateId && !candidatesStale(state)) {
      const card = state.cards.find((item) => item.candidate.id === state.activeCandidateId);
      if (card) return card.candidate.previewDocument;
    }
    return base;
  }, [state]);
}

function placement(panel: FigureDocumentV1["panels"][string], panelId: string) {
  const viewport = readyViewport(panel.assetId);
  if (!viewport) return null;
  return contentPlacement(panel.frameMm, panel.cropNormalized, viewport);
}

function isSelected(state: WorkspaceState, document: FigureDocumentV1, panelId: string): boolean {
  if (state.selection.kind === "panels") return state.selection.ids.includes(panelId);
  if (state.selection.kind === "label") return state.selection.panelId === panelId;
  if (state.selection.kind === "group") return document.groups[state.selection.groupId]?.panelIds.includes(panelId) ?? false;
  return false;
}

function selectPanel(document: FigureDocumentV1, panelId: string, shift: boolean): void {
  const group = groupForPanel(document, panelId);
  if (shift) {
    const current = useWorkspace.getState().selection;
    const ids = new Set(current.kind === "panels" ? current.ids : []);
    const incoming = group ? group.group.panelIds : [panelId];
    const remove = incoming.every((id) => ids.has(id));
    for (const id of incoming) {
      if (remove) ids.delete(id);
      else ids.add(id);
    }
    patch({ selection: { kind: "panels", ids: [...ids] } });
    return;
  }
  if (group) patch({ selection: { kind: "group", groupId: group.id } });
  else patch({ selection: { kind: "panels", ids: [panelId] } });
}

function pointOf(paper: HTMLDivElement, event: { clientX: number; clientY: number }, canvas: FigureDocumentV1["canvas"]) {
  const rect = paper.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.widthMm,
    y: ((event.clientY - rect.top) / rect.height) * canvas.heightMm,
  };
}

function beginMove(event: ReactPointerEvent, paper: HTMLDivElement | null, document: FigureDocumentV1, panelId: string): void {
  if (!paper) return;
  const group = groupForPanel(document, panelId);
  const ids = group ? [...group.group.panelIds] : [panelId];
  const frames = ids.flatMap((id) => {
    const frame = document.panels[id]?.frameMm;
    return frame ? [frame] : [];
  });
  const bounds = boundsOf(frames);
  if (!bounds) return;
  const others = document.panelOrder.flatMap((id) => (ids.includes(id) ? [] : document.panels[id] ? [document.panels[id].frameMm] : []));
  const start = pointOf(paper, event, document.canvas);
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  let raf = 0;
  const move = (ev: PointerEvent) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const point = pointOf(paper, ev, document.canvas);
      const snapped = snapTranslation({
        bounds,
        dx: point.x - start.x,
        dy: point.y - start.y,
        canvas: document.canvas,
        others,
        toleranceMm: snapToleranceMm(useWorkspace.getState().camera.zoom),
        enabled: !ev.altKey,
      });
      try {
        const command = translateSelection(document, ids, snapped.dx, snapped.dy);
        const preview = applyCommands(document, [command], assetLookup());
        patch({ interaction: preview, guides: snapped.guides, guidesFading: false, dragging: true, activeCandidateId: null });
      } catch (error) {
        patch({ liveMessage: error instanceof Error ? error.message : i18n.t("errors.generic") });
      }
    });
  };
  const finish = (ev: PointerEvent) => {
    cleanup();
    const point = pointOf(paper, ev, document.canvas);
    const snapped = snapTranslation({
      bounds,
      dx: point.x - start.x,
      dy: point.y - start.y,
      canvas: document.canvas,
      others,
      toleranceMm: snapToleranceMm(useWorkspace.getState().camera.zoom),
      enabled: !ev.altKey,
    });
    fadeGuides(snapped.guides);
    patch({ interaction: null, dragging: false });
    if (Math.abs(snapped.dx) < 0.0001 && Math.abs(snapped.dy) < 0.0001) return;
    void transact([translateSelection(document, ids, snapped.dx, snapped.dy)]);
  };
  const cancel = () => {
    cleanup();
    patch({ interaction: null, guides: [], dragging: false });
  };
  const cleanup = () => {
    cancelAnimationFrame(raf);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", cancel);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", cancel);
}

function beginScale(
  event: ReactPointerEvent,
  paper: HTMLDivElement | null,
  document: FigureDocumentV1,
  panelId: string,
  anchor: FrameAnchor,
): void {
  if (!paper || event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  let raf = 0;
  const move = (ev: PointerEvent) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const point = pointOf(paper, ev, document.canvas);
      const frame = document.panels[panelId]?.frameMm;
      if (!frame) return;
      const fixed = fixedCorner(frame, anchor);
      const width = Math.max(1, Math.abs(point.x - fixed.x));
      try {
        const command = scalePanel(document, panelId, { width }, anchor);
        const preview = applyCommands(document, [command], assetLookup());
        patch({ interaction: preview, dragging: true });
      } catch (error) {
        patch({ liveMessage: error instanceof Error ? error.message : i18n.t("errors.generic") });
      }
    });
  };
  const finish = (ev: PointerEvent) => {
    cleanup();
    const point = pointOf(paper, ev, document.canvas);
    const frame = document.panels[panelId]?.frameMm;
    patch({ interaction: null, dragging: false });
    if (!frame) return;
    const fixed = fixedCorner(frame, anchor);
    const width = Math.max(1, Math.abs(point.x - fixed.x));
    void transact([scalePanel(document, panelId, { width }, anchor)]);
  };
  const cancel = () => {
    cleanup();
    patch({ interaction: null, dragging: false });
  };
  const cleanup = () => {
    cancelAnimationFrame(raf);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", cancel);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", cancel);
}

function beginCrop(event: ReactPointerEvent, paper: HTMLDivElement | null, panelId: string, edge: string): void {
  if (!paper) return;
  const state = useWorkspace.getState();
  const document = baseDocument(state);
  const panel = document?.panels[panelId];
  const viewport = panel ? readyViewport(panel.assetId) : null;
  if (!document || !panel || !viewport) return;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const place = contentPlacement(panel.frameMm, panel.cropNormalized, viewport);
  let raf = 0;
  const move = (ev: PointerEvent) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const point = pointOf(paper, ev, document.canvas);
      const nx = (point.x - place.x) / place.width;
      const ny = (point.y - place.y) / place.height;
      const current = useWorkspace.getState().crop?.crop ?? panel.cropNormalized;
      const next = resizeCrop(current, edge, nx, ny);
      patch({ crop: { panelId, crop: next } });
    });
  };
  const end = () => {
    cancelAnimationFrame(raf);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function resizeCrop(
  crop: { x: number; y: number; width: number; height: number },
  edge: string,
  nx: number,
  ny: number,
) {
  let { x, y, width, height } = crop;
  if (edge.includes("e")) width = nx - x;
  if (edge.includes("s")) height = ny - y;
  if (edge.includes("w")) {
    width = x + width - nx;
    x = nx;
  }
  if (edge.includes("n")) {
    height = y + height - ny;
    y = ny;
  }
  if (width < 0.02) width = 0.02;
  if (height < 0.02) height = 0.02;
  return { x, y, width, height };
}

function beginPan(event: ReactPointerEvent): void {
  const startX = event.clientX;
  const startY = event.clientY;
  const camera = useWorkspace.getState().camera;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  patch({ dragging: true });
  const move = (ev: PointerEvent) => {
    patch({
      camera: { ...camera, panX: camera.panX + ev.clientX - startX, panY: camera.panY + ev.clientY - startY },
      dragging: true,
    });
  };
  const end = () => {
    patch({ dragging: false });
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function beginMarquee(event: ReactPointerEvent, document: FigureDocumentV1): void {
  if (event.button !== 0) return;
  const paper = (event.currentTarget as HTMLElement).querySelector(".paper");
  if (!(paper instanceof HTMLDivElement)) {
    if (!event.shiftKey) patch({ selection: { kind: "none" } });
    return;
  }
  const start = pointOf(paper, event, document.canvas);
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  let moved = false;
  const move = (ev: PointerEvent) => {
    const point = pointOf(paper, ev, document.canvas);
    if (Math.hypot(point.x - start.x, point.y - start.y) > 0.4) moved = true;
  };
  const end = (ev: PointerEvent) => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    if (!moved) {
      if (!ev.shiftKey) patch({ selection: { kind: "none" } });
      return;
    }
    const point = pointOf(paper, ev, document.canvas);
    const rect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    const ids = document.panelOrder.filter((id) => {
      const frame = document.panels[id]?.frameMm;
      if (!frame) return false;
      return frame.x < rect.x + rect.width && frame.x + frame.width > rect.x && frame.y < rect.y + rect.height && frame.y + frame.height > rect.y;
    });
    patch({ selection: ids.length > 0 ? { kind: "panels", ids } : { kind: "none" } });
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

function fadeGuides(guides: Guide[]): void {
  patch({ guides, guidesFading: true });
  const reduced = document.documentElement.dataset.reduceMotion === "true";
  window.setTimeout(() => patch({ guides: [], guidesFading: false }), reduced ? 80 : 180);
}

function opposite(corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"): FrameAnchor {
  if (corner === "top-left") return "bottom-right";
  if (corner === "top-right") return "bottom-left";
  if (corner === "bottom-left") return "top-right";
  return "top-left";
}

function fixedCorner(frame: { x: number; y: number; width: number; height: number }, anchor: FrameAnchor) {
  if (anchor === "top-left") return { x: frame.x, y: frame.y };
  if (anchor === "top-right") return { x: frame.x + frame.width, y: frame.y };
  if (anchor === "bottom-left") return { x: frame.x, y: frame.y + frame.height };
  return { x: frame.x + frame.width, y: frame.y + frame.height };
}

function cropHandleStyle(frame: { x: number; y: number; width: number; height: number }, edge: string, px: number): CSSProperties {
  const left = frame.x * px;
  const top = frame.y * px;
  const width = frame.width * px;
  const height = frame.height * px;
  const x = edge.includes("w") ? left : edge.includes("e") ? left + width : left + width / 2;
  const y = edge.includes("n") ? top : edge.includes("s") ? top + height : top + height / 2;
  return { left: x, top: y };
}
