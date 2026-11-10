import { TOLERANCES, type DomainCommand, type FigureDocumentV1 } from "@panelstudio/contracts";
import { applyCommands, assertLabelBounds, DocumentCommandError, type AssetLookup } from "@panelstudio/core";
import { insideMargins, intersects, nearly, occupiedRects } from "./measure.js";

/** Replays the stored commands and validates their actual outcome; never calls a solver. */
export function validateCandidateResult(
  base: FigureDocumentV1,
  commands: DomainCommand[],
  assets: AssetLookup,
  mode: "edit" | "layout",
): FigureDocumentV1 {
  const result = applyCommands(base, commands, assets);
  if (mode === "layout") assertStrictLayout(result);
  return result;
}

function assertStrictLayout(document: FigureDocumentV1): void {
  assertLabelBounds(null, document);
  const panels = document.panelOrder;
  const settings = document.layoutSettings;
  const min = settings.minPanelSizeMm;
  const tol = TOLERANCES.geometryComparisonMm;
  if (document.canvas.heightMode === "auto" && document.canvas.heightMm > settings.maxAutoHeightMm + tol) {
    throw new DocumentCommandError("LAYOUT_CONFLICT", "The layout exceeds its automatic canvas height limit.", {
      reason: "layout-max-height", panelIds: panels,
    });
  }
  assertLayoutConstraints(document, (id) => document.panels[id]!.frameMm);
  const boxes = panels.map((id) => {
    const frame = document.panels[id]!.frameMm;
    if (frame.width < min.width - tol || frame.height < min.height - tol) {
      throw new DocumentCommandError("LAYOUT_CONFLICT", "A panel is smaller than its minimum size.", {
        reason: "layout-min-size", panelIds: [id],
      });
    }
    const occupied = occupiedRects(document, id, frame);
    if (occupied.some((r) => !insideMargins(r, document.canvas))) {
      throw new DocumentCommandError("LAYOUT_CONFLICT", "A panel or its label leaves the canvas margins.", {
        reason: "layout-margin", panelIds: [id],
      });
    }
    return { id, occupied };
  });
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      if (a.occupied.some((r) => b.occupied.some((s) => intersects(r, s)))) {
        throw new DocumentCommandError("LAYOUT_CONFLICT", "Panels or their labels overlap.", {
          reason: "layout-overlap", panelIds: [a.id, b.id],
        });
      }
    }
  }
}

export function assertLayoutConstraints(
  document: FigureDocumentV1,
  frameOf: (panelId: string) => FigureDocumentV1["panels"][string]["frameMm"],
): void {
  const violated = document.layoutSettings.constraints.filter((constraint) => {
    const frames = constraint.panelIds.map(frameOf);
    const field = constraint.kind === "row" ? "y" : constraint.kind === "equalHeight" ? "height" : "width";
    return !frames.every((frame) => nearly(frame[field], frames[0]![field]));
  });
  if (violated.length) throw new DocumentCommandError("LAYOUT_CONFLICT", "The layout violates stored row or size constraints.", {
    reason: "layout-constraint", panelIds: [...new Set(violated.flatMap((c) => c.panelIds))], constraintIds: violated.map((c) => c.id),
  });
}
