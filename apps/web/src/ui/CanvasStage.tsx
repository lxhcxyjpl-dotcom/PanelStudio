import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { ARTWORK_COLOR_PRESETS, type DomainCommand, type FigureDocumentV1 } from "@panelstudio/contracts";
import { applyCommands } from "@panelstudio/core/apply";
import { scalePanel, translateSelection } from "@panelstudio/core/arrange";
import { contentPlacement, type FrameAnchor } from "@panelstudio/core/geometry";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { api, contentUrl } from "../api/client";
import { i18n } from "../i18n";
import { clickedSelection, completePanelIds, geometryLocked, panelIdsOf, withCrop } from "../model/document-ui";
import { PX_PER_MM } from "../model/place";
import { boundsOf, snapTranslation, type Guide } from "../model/snap";
import { fitCamera, snapToleranceMm } from "../model/view";
import { assetLookup, labelMove, openSample, readyViewport, transact } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { errorText } from "../model/feedback";
import { cancelGesture, trackGesture } from "./gesture";
import { CanvasTools } from "./CanvasTools";
import { baseDocument, type WorkspaceState } from "../state/types";

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
  const previewing = state.compareMode !== "editing";
  useEffect(() => () => { cancelGesture(); }, [state.projectId]);

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
    const node = viewportRef.current;
    if (!node || node.clientWidth < 40 || node.clientHeight < 40) return;
    patch({
      camera: fitCamera({width:node.clientWidth, height:node.clientHeight}, { width: art.canvas.widthMm, height: art.canvas.heightMm }),
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
  return <>
    <CanvasTools art={art} />
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
        if (!previewing) beginMarquee(event, base);
      }}
    >
      <div
        className="camera"
        style={{ "--inverse-zoom": 1 / state.camera.zoom, transform: `translate(${state.camera.panX}px, ${state.camera.panY}px) scale(${state.camera.zoom})` } as CSSProperties}
      >
        <div
          ref={paperRef}
          className="paper"
          data-canvas-paper="true"
          data-view={state.compareMode}
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
                data-selected={selected}
                data-frame={`${panel.frameMm.x},${panel.frameMm.y},${panel.frameMm.width},${panel.frameMm.height}`}
                style={{
                  transform: `translate(${panel.frameMm.x * px}px, ${panel.frameMm.y * px}px)`,
                  width: panel.frameMm.width * px,
                  height: panel.frameMm.height * px,
                  boxShadow: selected ? `0 0 0 1px ${ARTWORK_COLOR_PRESETS[1]}, 0 0 0 2px var(--document-paper)` : undefined,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.button !== 0) return;
                  event.preventDefault();
                  viewportRef.current?.focus({ preventScroll: true });
                  if (state.spacePan) {
                    beginPan(event);
                    return;
                  }
                  if (state.crop) return;
                  if (previewing) {
                    const ai = useWorkspace.getState().cards.some((card) => card.candidate.origin === "ai");
                    patch({ selection: clickedSelection(art, state.selection, panelId, event.shiftKey), liveMessage: i18n.t(ai ? "ai.previewOnly" : "canvas.previewOnly") });
                    return;
                  }
                  beginMove(event, paperRef.current, base, panelId);
                }}
              >
                {place ? (
                  <div className="panel-artwork"><img
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
                  /></div>
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
          <svg className="label-artwork" viewBox={`0 0 ${art.canvas.widthMm} ${art.canvas.heightMm}`} aria-hidden="true">
            {art.panelOrder.map((id) => {
              const label = resolvePanelLabel(art, id);
              return label && label.bounds ? <text key={id} x={label.x} y={label.y} fill={label.color} fontFamily={label.fontFamily}
                fontSize={label.fontSizeUser} fontWeight={label.fontWeight} xmlSpace="preserve">{label.text}</text> : null;
            })}
          </svg>
          {art.panelOrder.map((panelId) => {
            const label = resolvePanelLabel(art, panelId);
            if (!label?.bounds) return null;
            const box = label.bounds;
            const selected = !previewing && state.selection.kind === "label" && state.selection.panelId === panelId;
            const minHit = 18 / state.camera.zoom;
            return <button key={panelId} type="button" data-action="select-label" data-label-id={panelId}
              aria-label={i18n.t("labels.select", { label: label.text })} className="label-hit"
              style={{ left: (box.x + box.width / 2) * px, top: (box.y + box.height / 2) * px,
                width: Math.max(minHit, box.width * px), height: Math.max(minHit, box.height * px) }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault(); event.stopPropagation();
                viewportRef.current?.focus({ preventScroll: true });
                if (state.spacePan) return beginPan(event);
                if (previewing || state.crop) return;
                beginLabelMove(event, paperRef.current, base, panelId);
              }}>
              {selected ? <span className="label-outline" style={{ width: box.width * px, height: box.height * px }} /> : null}
            </button>;
          })}
          {state.marquee ? <div className="marquee" data-testid="marquee" style={{
            left: state.marquee.x * px, top: state.marquee.y * px, width: state.marquee.width * px, height: state.marquee.height * px,
          }} /> : null}
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
  </>;
}

function EmptyCanvas({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className={overlay ? "empty-overlay" : "empty-state"}>
      <h2>{i18n.t("app.emptyTitle")}</h2>
      <div className="empty-actions">
        <button type="button" className="button primary" data-action="empty-import" title={i18n.t("app.formats")} onClick={() => document.getElementById("import-input")?.click()}>
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
    if (state.compareMode === "original" && state.candidateRoot) return state.candidateRoot.document;
    if (state.activeCandidateId && state.compareMode === "draft") {
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

function pointOf(paper: HTMLDivElement, event: { clientX: number; clientY: number }, canvas: FigureDocumentV1["canvas"]) {
  const rect = paper.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.widthMm,
    y: ((event.clientY - rect.top) / rect.height) * canvas.heightMm,
  };
}

function beginMove(event: ReactPointerEvent, paper: HTMLDivElement | null, document: FigureDocumentV1, id: string) {
  if (!paper) return;
  const initial = useWorkspace.getState().selection;
  const selected = clickedSelection(document, initial, id, event.shiftKey, true);
  const ids = completePanelIds(document, panelIdsOf(selected, document));
  const bounds = boundsOf(ids.map((panelId) => document.panels[panelId]!.frameMm));
  if (!bounds) return;
  const locked = ids.some((panelId) => geometryLocked(document, panelId) === "lock");
  const others = document.panelOrder.filter((panelId) => !ids.includes(panelId)).map((panelId) => document.panels[panelId]!.frameMm);
  const origin = pointOf(paper, event, document.canvas);
  const make = (pointer: PointerEvent) => {
    const point = pointOf(paper, pointer, document.canvas);
    const snap = snapTranslation({ bounds, dx: point.x - origin.x, dy: point.y - origin.y, canvas: document.canvas,
      others, toleranceMm: snapToleranceMm(useWorkspace.getState().camera.zoom), enabled: !pointer.altKey });
    return { command: translateSelection(document, ids, snap.dx, snap.dy), guides: snap.guides };
  };
  const shift = event.shiftKey;
  trackGesture(event, {
    drag(pointer) {
      if (locked) return patch({ liveMessage: i18n.t("errors.LOCKED_ELEMENT") });
      patch({ selection: selected });
      previewCommand(document, () => make(pointer));
    },
    finish(pointer, dragged) {
      patch({ interaction: null, dragging: false, guides: [] });
      if (!dragged) return patch({ selection: clickedSelection(document, initial, id, shift) });
      if (locked) return patch({ liveMessage: i18n.t("errors.LOCKED_ELEMENT") });
      try {
        const { command, guides } = make(pointer);
        patch({ selection: selected }); fadeGuides(guides);
        void transact([command]);
      } catch (error) { patch({ liveMessage: errorText(error) }); }
    },
    cancel() { patch({ selection: initial, interaction: null, dragging: false, guides: [] }); },
  });
}

function previewCommand(doc: FigureDocumentV1, build: () => { command: DomainCommand; guides?: Guide[] }) {
  try {
    const { command, guides = [] } = build();
    patch({ interaction: applyCommands(doc, [command], assetLookup()), guides, guidesFading: false, dragging: true });
  } catch (error) { patch({ liveMessage: errorText(error) }); }
}

function beginLabelMove(event: ReactPointerEvent, paper: HTMLDivElement | null, document: FigureDocumentV1, id: string) {
  if (!paper) return;
  const initial = useWorkspace.getState().selection;
  const origin = pointOf(paper, event, document.canvas);
  const make = (pointer: PointerEvent) => {
    const point = pointOf(paper, pointer, document.canvas);
    return labelMove(document, id, point.x - origin.x, point.y - origin.y);
  };
  patch({ selection: { kind: "label", panelId: id } });
  trackGesture(event, {
    drag(pointer) { previewCommand(document, () => ({ command: make(pointer) })); },
    finish(pointer, dragged) {
      patch({ interaction: null, dragging: false });
      if (dragged) void transact([make(pointer)]);
    },
    cancel() { patch({ selection: initial, interaction: null, dragging: false }); },
  });
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
  if (!(paper instanceof HTMLDivElement)) return;
  const initial = useWorkspace.getState().selection;
  const origin = pointOf(paper, event, document.canvas);
  const extend = event.shiftKey;
  const existing = extend ? completePanelIds(document, panelIdsOf(initial, document)) : [];
  const update = (pointer: PointerEvent, preview: boolean) => {
    const point = pointOf(paper, pointer, document.canvas);
    const rect = { x: Math.min(point.x, origin.x), y: Math.min(point.y, origin.y), width: Math.abs(point.x - origin.x), height: Math.abs(point.y - origin.y) };
    const hits = document.panelOrder.filter((id) => {
      const f = document.panels[id]!.frameMm;
      return f.x < rect.x + rect.width && f.x + f.width > rect.x && f.y < rect.y + rect.height && f.y + f.height > rect.y;
    });
    const ids = completePanelIds(document, [...existing, ...hits]);
    patch({ marquee: preview ? rect : null, dragging: preview, selection: ids.length ? { kind: "panels", ids } : { kind: "none" } });
  };
  trackGesture(event, {
    drag(pointer) { update(pointer, true); },
    finish(pointer, dragged) {
      if (dragged) update(pointer, false);
      else if (!extend) patch({ selection: { kind: "none" } });
    },
    cancel() { patch({ marquee: null, dragging: false, selection: initial }); },
  });
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
