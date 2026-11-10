const MiB = 1024 * 1024;

/** Document schema version. The only figure document model is version 1. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Application version reported by health.
 * Phase 5 wires provider settings and AI layout jobs. Layout and SVG engines
 * stay at their phase 3 and phase 1 versions.
 */
export const APP_VERSION = "0.1.0-phase5" as const;

/**
 * Layout scoring is recorded with this engine version.
 * The SVG compiler shipped in phase 1. The font registry version identifies the
 * bundled family list. Font files are still not vendored.
 */
export const ENGINE_VERSIONS = {
  layout: "0.1.0",
  svg: "0.1.0",
  fontRegistry: "1",
} as const;

export const NORMALIZATION_VERSION = "1";

export const AI_ADAPTER_ID = "openai-compatible" as const;

export const RESOURCE_LIMITS = {
  maxPanelsPerProject: 8,
  maxAssetsPerProject: 32,
  maxUploadBytes: 25 * MiB,
  maxOriginalAssetBytesPerProject: 200 * MiB,
  maxRasterDecodePixels: 50_000_000,
  maxSvgElements: 100_000,
  maxCommandsPerTransaction: 64,
  maxAiPromptCharacters: 4_000,
  maxCustomLabelCharacters: 16,
  maxPngOutputPixels: 60_000_000,
  maxPngOutputEdgePx: 16_000,
  maxProjectPackageUncompressedBytes: 512 * MiB,
  minAutoLayoutPanels: 2,
  maxAutoLayoutPanels: 8,
  maxLayoutCandidates: 3,
  aiModelCallBudget: 3,
} as const;

/** Editor comparison tolerances. Illustrator acceptance uses a separate set. */
export const TOLERANCES = {
  geometryComparisonMm: 0.0001,
  uniformScaleRelative: 0.000001,
  svgCoordinateDecimalPlaces: 6,
} as const;

export const ILLUSTRATOR_ACCEPTANCE = {
  positionMm: 0.1,
  labelFontSizePt: 0.1,
} as const;

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export const PNG_DPI_OPTIONS = [150, 300, 600] as const;

export const LAYOUT_SCORE_WEIGHTS = {
  readability: 0.25,
  whitespace: 0.2,
  emphasis: 0.2,
  consistency: 0.15,
  height: 0.1,
  movement: 0.1,
} as const;

export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export const NUDGE_MM = {
  step: 0.1,
  shiftStep: 1,
} as const;

export const JOB_EVENT_NAMES = [
  "job.queued",
  "job.started",
  "job.progress",
  "job.completed",
  "job.failed",
  "job.cancelled",
] as const;

export const DOMAIN_COMMAND_NAMES = [
  "panel.add",
  "panel.remove",
  "panel.rename",
  "panel.replaceAsset",
  "panel.setFrames",
  "panel.setCrop",
  "panel.setLocked",
  "panel.reorderLabels",
  "panel.setStackOrder",
  "label.setStyle",
  "label.setOverrides",
  "canvas.set",
  "layout.setSettings",
  "group.create",
  "group.rename",
  "group.remove",
  "group.setLocked",
] as const;

export const AI_ACTION_NAMES = [
  "layout",
  "set_canvas",
  "set_gutter",
  "set_label_style",
  "set_panel_label",
  "move_by_mm",
  "scale_to_width",
  "align",
  "distribute",
  "set_lock",
  "relabel",
] as const;

export const IMPORT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export const RENDER_MEDIA_TYPES = ["image/png", "image/svg+xml"] as const;

export const EXPORT_FORMATS = ["svg", "png", "project"] as const;

export const LAYOUT_FAMILIES = ["auto", "rows", "hero-top", "hero-left"] as const;

export const NON_DOCUMENT_CLIENT_STATE = [
  "theme",
  "locale",
  "zoom",
  "selection",
  "apiKey",
] as const;

export const BUILTIN_LOCALES = ["zh-CN", "en-US"] as const;

export const EXTENSION_LOCALE_IDS = [
  "zh-TW",
  "ja-JP",
  "ko-KR",
  "de-DE",
  "fr-FR",
  "es-ES",
] as const;

export const LOCALE_NAMESPACES = [
  "app",
  "toolbar",
  "assets",
  "panels",
  "canvas",
  "inspector",
  "crop",
  "labels",
  "layout",
  "ai",
  "history",
  "export",
  "settings",
  "errors",
  "a11y",
] as const;

export const ARTWORK_COLOR_PRESETS = [
  "#000000",
  "#333333",
  "#666666",
  "#B3B3B3",
  "#FFFFFF",
] as const;

export const BUNDLED_FONTS = [
  {
    fontId: "noto-sans",
    family: "Noto Sans",
    weights: [400, 700],
    bundled: true,
  },
  {
    fontId: "noto-sans-sc",
    family: "Noto Sans SC",
    weights: [400, 700],
    bundled: true,
  },
] as const;
