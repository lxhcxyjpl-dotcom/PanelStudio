import {
  FULL_CROP,
  fontSizePtToSvgUserUnits,
  type DomainCommand,
  type FigureDocumentV1,
} from "@panelstudio/contracts";
import { LABEL_EM_ASCENT } from "@panelstudio/core/labels";

export const PX_PER_MM = 96 / 25.4;

type Viewport = { width: number; height: number };

/**
 * Places new full-crop panels inside the current canvas.
 * Overlap is allowed. Leaving the canvas is not.
 * Label clearance uses the same em box as the editor kernel.
 */
export function placePanelCommands(
  document: FigureDocumentV1,
  additions: Array<{ panelId: string; assetId: string; viewport: Viewport }>,
): DomainCommand[] {
  const { canvas, labelStyle } = document;
  const ascent = fontSizePtToSvgUserUnits(labelStyle.fontSizePt) * LABEL_EM_ASCENT;
  const labelReserve = labelStyle.placement === "outside-top-left" ? labelStyle.gapMm + ascent : 0;
  const top = Math.max(canvas.marginsMm.top, labelReserve);
  const left = canvas.marginsMm.left;
  const right = canvas.widthMm - canvas.marginsMm.right;
  const bottom = canvas.heightMm - canvas.marginsMm.bottom;
  let x = left;
  let y = top;
  let rowHeight = 0;
  const commands: DomainCommand[] = [];
  for (const addition of additions) {
    const frame = fittedFrame(addition.viewport, right - left, bottom - top);
    if (x > left && x + frame.width > right) {
      x = left;
      y += rowHeight + document.layoutSettings.gutterMm.vertical;
      rowHeight = 0;
    }
    const yClamped = Math.min(Math.max(top, y), Math.max(top, bottom - frame.height));
    const xClamped = Math.min(Math.max(left, x), Math.max(left, right - frame.width));
    commands.push({
      type: "panel.add",
      panelId: addition.panelId,
      assetId: addition.assetId,
      frameMm: { x: xClamped, y: yClamped, width: frame.width, height: frame.height },
    });
    x = xClamped + frame.width + document.layoutSettings.gutterMm.horizontal;
    rowHeight = Math.max(rowHeight, frame.height);
  }
  return commands;
}

function fittedFrame(viewport: Viewport, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const aspect = viewport.width / viewport.height;
  let width = Math.min(42, maxWidth);
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  if (!(width > 0) || !(height > 0)) {
    return { width: Math.min(20, maxWidth), height: Math.min(20, maxHeight) };
  }
  return { width, height };
}

export function fullCrop() {
  return { ...FULL_CROP };
}
