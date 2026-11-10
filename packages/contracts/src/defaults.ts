import type { FigureDocumentV1 } from "./document.js";

export const DEFAULT_CANVAS_WIDTH_MM = 180;
export const DEFAULT_CANVAS_HEIGHT_MM = 120;
export const DEFAULT_MARGIN_MM = 4;
export const DEFAULT_GUTTER_MM = 4;
export const DEFAULT_PREFERRED_HEIGHT_MM = 120;
export const DEFAULT_MAX_AUTO_HEIGHT_MM = 240;
export const DEFAULT_MIN_PANEL_WIDTH_MM = 15;
export const DEFAULT_MIN_PANEL_HEIGHT_MM = 10;
export const DEFAULT_TARGET_RASTER_PPI = 300;
export const DEFAULT_LABEL_FONT_SIZE_PT = 9;
export const DEFAULT_LABEL_GAP_MM = 1;
export const DEFAULT_LABEL_COLOR = "#000000";
export const DEFAULT_CANVAS_BACKGROUND = "#FFFFFF" as const;
export const DEFAULT_PNG_DPI = 600 as const;
export const DEFAULT_RELATIVE_ENLARGE = 0.15;
export const CANVAS_WIDTH_PRESETS_MM = [85, 120, 180] as const;

/** Full-image crop used when panel.add omits cropNormalized. */
export const FULL_CROP = { x: 0, y: 0, width: 1, height: 1 } as const;

export function createDefaultFigureDocument(): FigureDocumentV1 {
  const document = {
    schemaVersion: 1 as const,
    canvas: {
      widthMm: DEFAULT_CANVAS_WIDTH_MM,
      heightMm: DEFAULT_CANVAS_HEIGHT_MM,
      heightMode: "auto" as const,
      background: DEFAULT_CANVAS_BACKGROUND,
      marginsMm: {
        top: DEFAULT_MARGIN_MM,
        right: DEFAULT_MARGIN_MM,
        bottom: DEFAULT_MARGIN_MM,
        left: DEFAULT_MARGIN_MM,
      },
    },
    panels: {},
    panelOrder: [],
    stackOrder: [],
    groups: {},
    labelStyle: {
      fontId: "noto-sans" as const,
      fontSizePt: DEFAULT_LABEL_FONT_SIZE_PT,
      fontWeight: 700 as const,
      color: DEFAULT_LABEL_COLOR,
      visible: true,
      sequence: "upper-alpha" as const,
      format: "plain" as const,
      placement: "outside-top-left" as const,
      gapMm: DEFAULT_LABEL_GAP_MM,
    },
    layoutSettings: {
      gutterMm: {
        horizontal: DEFAULT_GUTTER_MM,
        vertical: DEFAULT_GUTTER_MM,
      },
      primaryPanelId: null,
      minPanelSizeMm: {
        width: DEFAULT_MIN_PANEL_WIDTH_MM,
        height: DEFAULT_MIN_PANEL_HEIGHT_MM,
      },
      preferredHeightMm: DEFAULT_PREFERRED_HEIGHT_MM,
      maxAutoHeightMm: DEFAULT_MAX_AUTO_HEIGHT_MM,
      targetRasterPpi: DEFAULT_TARGET_RASTER_PPI,
      constraints: [],
    },
  } satisfies FigureDocumentV1;
  return document;
}
