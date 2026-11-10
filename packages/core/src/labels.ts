import {
  BUNDLED_FONTS,
  fontSizePtToSvgUserUnits,
  resolveLabelText,
  type FigureDocumentV1,
  type LabelOverrides,
  type LabelStyle,
  type LabelTypography,
} from "@panelstudio/contracts";

/**
 * Approximate em box for on-canvas checks.
 * Font files are not vendored, so phase 1 does not measure Noto outlines.
 * Ascent 0.8em covers capitals; descent 0.2em covers a typical descender.
 * Advance 0.7em is a Latin cap width used as the label's horizontal extent.
 */
export const LABEL_EM_ASCENT = 0.8;
export const LABEL_EM_DESCENT = 0.2;
export const LABEL_EM_ADVANCE = 0.7;

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
  bounds: Rect;
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
  const fontSizeUser = fontSizePtToSvgUserUnits(face.fontSizePt);
  const placement = overrides.placement ?? style.placement;
  let x: number;
  let y: number;
  if (overrides.offsetMm) {
    x = panel.frameMm.x + overrides.offsetMm.x;
    y = panel.frameMm.y + overrides.offsetMm.y;
  } else if (placement === "outside-top-left") {
    x = panel.frameMm.x;
    y = panel.frameMm.y - style.gapMm;
  } else {
    x = panel.frameMm.x + style.gapMm;
    y = panel.frameMm.y + style.gapMm + fontSizeUser;
  }
  const ascent = fontSizeUser * LABEL_EM_ASCENT;
  const descent = fontSizeUser * LABEL_EM_DESCENT;
  const width = Math.max(1, [...text].length) * fontSizeUser * LABEL_EM_ADVANCE;
  return {
    text,
    x,
    y,
    fontFamily: fontFamilyForId(face.fontId),
    fontSizeUser,
    fontWeight: face.fontWeight,
    color: face.color,
    bounds: {
      x,
      y: y - ascent,
      width,
      height: ascent + descent,
    },
  };
}
