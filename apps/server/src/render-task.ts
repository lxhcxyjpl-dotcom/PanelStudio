import type { Diagnostic, FigureDocumentV1, NormalizedAsset } from "@panelstudio/contracts";
import { contentPlacement, resolvePanelLabel } from "@panelstudio/core";
import { compileFigureSvg, type ExportPanel } from "@panelstudio/svg";
import { BlobStore } from "./blobs.js";
import { isBundledFamily, missingGlyphs } from "./fonts.js";
import { rasterizeSvg } from "./raster.js";

export type RenderSnapshot = {
  document: FigureDocumentV1;
  dataDir: string;
  assets: Record<string, { normalized: NormalizedAsset; blobPath: string }>;
  revision: number;
};

export type RenderTask = { snapshot: RenderSnapshot; pixelWidth: number };
export type RenderedPng = { bytes: Uint8Array; diagnostics: Diagnostic[] };

export function compileSnapshot(snapshot: RenderSnapshot, includeMetadata: boolean) {
  const { document, assets, revision } = snapshot;
  const blobs = new BlobStore(snapshot.dataDir);
  const panels: ExportPanel[] = document.stackOrder.map((panelId) => {
    const panel = document.panels[panelId]!;
    const asset = assets[panel.assetId]!;
    const placement = contentPlacement(panel.frameMm, panel.cropNormalized, asset.normalized.viewport);
    const resolved = resolvePanelLabel(document, panelId);
    const label = resolved && {
      text: resolved.text, x: resolved.x, y: resolved.y, fontFamily: resolved.fontFamily,
      fontSizeUser: resolved.fontSizeUser, fontWeight: resolved.fontWeight, color: resolved.color,
    };
    const common = { panelId, frame: panel.frameMm, label, x: placement.x, y: placement.y };
    const bytes = blobs.read(asset.blobPath);
    return asset.normalized.renderMediaType === "image/svg+xml"
      ? { ...common, kind: "vector", normalizedSvg: bytes.toString("utf8"), scale: placement.scale }
      : { ...common, kind: "raster", png: bytes, width: placement.width, height: placement.height };
  });
  const compiled = compileFigureSvg({ widthMm: document.canvas.widthMm, heightMm: document.canvas.heightMm,
    revision, includeMetadata, panels });
  const diagnostics: Diagnostic[] = compiled.fontFamilies.filter((family) => !isBundledFamily(family))
    .map((family) => ({ code: "FONT_MISSING", severity: "warning", messageKey: "font.notInstalled", params: { family } }));
  for (const { label } of panels) {
    if (!label) continue;
    const glyphs = missingGlyphs(label.fontFamily, label.fontWeight, label.text);
    if (glyphs.length) diagnostics.push({ code: "FONT_MISSING", severity: "warning", messageKey: "font.missingGlyph",
      params: { family: label.fontFamily, glyphs: glyphs.join(" ") } });
  }
  return { svg: compiled.svg, diagnostics };
}

export function executeRender(task: RenderTask): RenderedPng {
  const { svg, diagnostics } = compileSnapshot(task.snapshot, false);
  return { bytes: rasterizeSvg(svg, task.pixelWidth), diagnostics };
}
