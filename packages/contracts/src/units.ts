import { MM_PER_INCH, PNG_DPI_OPTIONS, PT_PER_INCH } from "./constants.js";

export const UNITS = {
  documentGeometry: "mm",
  fontSize: "pt",
  crop: "normalized-0-1",
  ui: "css-px",
  svgUserUnit: "mm",
} as const;

/** pt → SVG user units when one user unit is one millimeter. */
export function fontSizePtToSvgUserUnits(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt)) {
    throw new Error("font size must be finite");
  }
  return (fontSizePt * MM_PER_INCH) / PT_PER_INCH;
}

/** pixels = round(mm / 25.4 × dpi). Does not change the document size. */
export function pngPixelsFromMm(
  mm: number,
  dpi: (typeof PNG_DPI_OPTIONS)[number],
): number {
  if (!Number.isFinite(mm)) {
    throw new Error("millimeters must be finite");
  }
  return Math.round((mm / MM_PER_INCH) * dpi);
}
