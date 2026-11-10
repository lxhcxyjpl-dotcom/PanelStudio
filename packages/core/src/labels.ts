import {
  BUNDLED_FONTS,
  fontSizePtToSvgUserUnits,
  resolveLabelText,
  type FigureDocumentV1,
  type LabelOverrides,
  type LabelStyle,
  type LabelTypography,
} from "@panelstudio/contracts";
import { measureLabel, type LabelMeasureResult } from "@panelstudio/text-metrics";
export { measureLabel, initializeLabelFonts } from "@panelstudio/text-metrics";
export { labelDiagnostics } from "./label-validation.js";

export const INHERITED_LABEL_OVERRIDES: LabelOverrides = {
  visible: null,
  text: null,
  placement: null,
  offsetMm: null,
  typography: null,
};

export type Rect = { x: number; y: number; width: number; height: number };

export type ResolvedLabel = {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSizeUser: number;
  fontWeight: 400 | 700;
  color: string;
  bounds: Rect | null;
  measurement: LabelMeasureResult;
};

export function fontFamilyForId(fontId: LabelTypography["fontId"]): string {
  const font = BUNDLED_FONTS.find((item) => item.fontId === fontId);
  if (!font) throw new Error(`unknown font id ${fontId}`);
  return font.family;
}

export function labelIsVisible(style: LabelStyle, overrides: LabelOverrides): boolean {
  if (!style.visible) return false;
  if (overrides.visible === null) return true;
  return overrides.visible;
}

function typography(style: LabelStyle, overrides: LabelOverrides): LabelTypography {
  const patch = overrides.typography;
  return {
    fontId: patch?.fontId ?? style.fontId,
    fontSizePt: patch?.fontSizePt ?? style.fontSizePt,
    fontWeight: patch?.fontWeight ?? style.fontWeight,
    color: patch?.color ?? style.color,
  };
}

/** Baseline placement for a panel label. Null when the label is hidden. */
export function resolvePanelLabel(
  document: FigureDocumentV1,
  panelId: string,
  proposedFrame?: Rect,
): ResolvedLabel | null {
  const panel = document.panels[panelId];
  if (!panel) return null;
  const style = document.labelStyle;
  const overrides = panel.labelOverrides;
  if (!labelIsVisible(style, overrides)) return null;
  const index = document.panelOrder.indexOf(panelId);
  if (index < 0) return null;
  const text = resolveLabelText({
    index,
    textOverride: overrides.text,
    sequence: style.sequence,
    format: style.format,
  });
  const face = typography(style, overrides);
  const frame = proposedFrame ?? panel.frameMm;
  const fontSizeUser = fontSizePtToSvgUserUnits(face.fontSizePt);
  const placement = overrides.placement ?? style.placement;
  let x: number;
  let y: number;
  if (overrides.offsetMm) {
    x = frame.x + overrides.offsetMm.x;
    y = frame.y + overrides.offsetMm.y;
  } else if (placement === "outside-top-left") {
    x = frame.x;
    y = frame.y - style.gapMm;
  } else {
    x = frame.x + style.gapMm;
    y = frame.y + style.gapMm + fontSizeUser;
  }
  const measurement = measureLabel({ ...face, text });
  const ink = measurement.status === "measured" ? measurement.inkBoundsMm : null;
  return {
    text,
    x,
    y,
    fontFamily: fontFamilyForId(face.fontId),
    fontSizeUser,
    fontWeight: face.fontWeight,
    color: face.color,
    bounds: ink ? { ...ink, x: x + ink.x, y: y + ink.y } : null,
    measurement,
  };
}
