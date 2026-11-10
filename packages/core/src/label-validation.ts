import { TOLERANCES, type Diagnostic, type FigureDocumentV1 } from "@panelstudio/contracts";
import { DocumentCommandError } from "./errors.js";
import { resolvePanelLabel, type Rect, type ResolvedLabel } from "./labels.js";

function overflow(rect: Rect | null | undefined, canvas: FigureDocumentV1["canvas"]): number[] {
  if (!rect) return [0, 0, 0, 0];
  return [Math.max(0, -rect.x), Math.max(0, -rect.y),
    Math.max(0, rect.x + rect.width - canvas.widthMm), Math.max(0, rect.y + rect.height - canvas.heightMm)];
}

function sameGeometry(before: ResolvedLabel | null, after: ResolvedLabel): boolean {
  return before !== null && before.text === after.text && before.fontFamily === after.fontFamily &&
    before.fontWeight === after.fontWeight && before.fontSizeUser === after.fontSizeUser &&
    before.x === after.x && before.y === after.y;
}

/** Omitting a baseline requires every visible label to be measurable and on the canvas. */
export function assertLabelBounds(base: FigureDocumentV1 | null, next: FigureDocumentV1): void {
  const worsened: string[] = [];
  for (const id of next.panelOrder) {
    const label = resolvePanelLabel(next, id);
    if (!label) continue;
    const old = base ? resolvePanelLabel(base, id) : null;
    if (label.measurement.status === "unavailable") {
      if (base && base.canvas.widthMm === next.canvas.widthMm && base.canvas.heightMm === next.canvas.heightMm &&
          sameGeometry(old, label)) continue;
      const reason = label.measurement.reason;
      throw new DocumentCommandError("TEXT_METRICS_UNAVAILABLE", reason === "missing-glyph"
        ? "Choose a bundled face containing all label characters or change the label text."
        : "Use a supported single-line label without layout control characters.", { panelIds: [id], reason });
    }
    const previous = base ? overflow(old?.bounds, base.canvas) : [0, 0, 0, 0];
    if (overflow(label.bounds, next.canvas).some((value, edge) => value > previous[edge]! + TOLERANCES.geometryComparisonMm)) {
      worsened.push(id);
    }
  }
  if (worsened.length) throw new DocumentCommandError("OUTSIDE_CANVAS", "A label would extend further outside the canvas.", { panelIds: worsened });
}

/** Reading an older document never alters its geometry, its hash, or its history. */
export function labelDiagnostics(document: FigureDocumentV1): Diagnostic[] {
  const results: Diagnostic[] = [];
  for (const id of document.panelOrder) {
    const label = resolvePanelLabel(document, id);
    if (!label) continue;
    if (label.measurement.status === "unavailable") {
      const missing = label.measurement.reason === "missing-glyph";
      results.push({ code: "TEXT_METRICS_UNAVAILABLE", severity: "warning", panelIds: [id],
        messageKey: missing ? "errors.labelMissingGlyph" : "errors.labelUnsupportedLayout",
        params: { characters: label.measurement.characters?.join("") ?? "" } });
    } else if (overflow(label.bounds, document.canvas).some((v) => v > TOLERANCES.geometryComparisonMm)) {
      results.push({ code: "OUTSIDE_CANVAS", severity: "warning", panelIds: [id], messageKey: "errors.labelOutsideCanvas", params: {} });
    }
  }
  return results;
}
