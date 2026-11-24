import { interaction } from "@panelstudio/ui";
import { PX_PER_MM } from "./place";

export type Camera = { zoom: number; panX: number; panY: number };
type Viewport = { width: number; height: number };

export function clampZoom(zoom: number): number {
  return Math.min(interaction.zoom.max, Math.max(interaction.zoom.min, zoom));
}

export function fitCamera(viewport: { width: number; height: number }, canvasMm: { width: number; height: number }): Camera {
  const paperW = canvasMm.width * PX_PER_MM;
  const paperH = canvasMm.height * PX_PER_MM;
  const inset = viewport.width < 520 ? 16 : 40;
  const availableW = Math.max(1, viewport.width - inset * 2);
  const availableH = Math.max(1, viewport.height - inset * 2);
  const zoom = clampZoom(Math.min(availableW / paperW, availableH / paperH));
  return {
    zoom,
    panX: (viewport.width - paperW * zoom) / 2,
    panY: (viewport.height - paperH * zoom) / 2,
  };
}

export function centerFrameCamera(
  camera: Camera,
  viewport: { width: number; height: number },
  frame: { x: number; y: number; width: number; height: number },
): Camera {
  const zoom = Math.min(camera.zoom, fitCamera(viewport, frame).zoom);
  return {
    zoom,
    panX: viewport.width / 2 - (frame.x + frame.width / 2) * PX_PER_MM * zoom,
    panY: viewport.height / 2 - (frame.y + frame.height / 2) * PX_PER_MM * zoom,
  };
}

export function zoomAt(camera: Camera, factor: number, origin: { x: number; y: number }): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const worldX = (origin.x - camera.panX) / camera.zoom;
  const worldY = (origin.y - camera.panY) / camera.zoom;
  return {
    zoom,
    panX: origin.x - worldX * zoom,
    panY: origin.y - worldY * zoom,
  };
}

export function actualSize(camera: Camera, viewport: { width: number; height: number }): Camera {
  return zoomAt(camera, 1 / camera.zoom, { x: viewport.width / 2, y: viewport.height / 2 });
}

export function resizeCamera(camera: Camera, before: Viewport, after: Viewport): Camera {
  return {
    zoom: camera.zoom,
    panX: camera.panX + (after.width - before.width) / 2,
    panY: camera.panY + (after.height - before.height) / 2,
  };
}

export function keepFrameVisible(camera: Camera, viewport: Viewport, frame: { x: number; y: number; width: number; height: number }): Camera {
  const px = PX_PER_MM * camera.zoom;
  const panX = keepAxisVisible(camera.panX, frame.x * px, frame.width * px, viewport.width);
  const panY = keepAxisVisible(camera.panY, frame.y * px, frame.height * px, viewport.height);
  return panX === camera.panX && panY === camera.panY ? camera : { zoom: camera.zoom, panX, panY };
}

function keepAxisVisible(pan: number, start: number, size: number, available: number) {
  const pad = Math.min(12, available / 4);
  if (size > available - 2 * pad) return (available - size) / 2 - start;
  return Math.max(pad - start, Math.min(available - pad - start - size, pan));
}

export function snapToleranceMm(zoom: number): number {
  return interaction.snapTolerancePx / (PX_PER_MM * zoom);
}
