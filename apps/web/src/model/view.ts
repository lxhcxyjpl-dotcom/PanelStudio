import { interaction } from "@panelstudio/ui";
import { PX_PER_MM } from "./place";

export type Camera = { zoom: number; panX: number; panY: number };

export function clampZoom(zoom: number): number {
  return Math.min(interaction.zoom.max, Math.max(interaction.zoom.min, zoom));
}

export function fitCamera(viewport: { width: number; height: number }, canvasMm: { width: number; height: number }): Camera {
  const paperW = canvasMm.width * PX_PER_MM;
  const paperH = canvasMm.height * PX_PER_MM;
  const availableW = Math.max(1, viewport.width - 80);
  const availableH = Math.max(1, viewport.height - 80);
  const zoom = clampZoom(Math.min(availableW / paperW, availableH / paperH));
  return {
    zoom,
    panX: (viewport.width - paperW * zoom) / 2,
    panY: (viewport.height - paperH * zoom) / 2,
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

export function snapToleranceMm(zoom: number): number {
  return interaction.snapTolerancePx / (PX_PER_MM * zoom);
}
