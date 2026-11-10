import { SCHEMA_VERSION } from "@panelstudio/contracts";
import { instantiateSvg } from "./instantiate.js";
import { formatSvgNumber } from "./number.js";
import { escapeAttr, escapeText } from "./xml.js";

export type ExportLabel = {
  text: string;
  x: number;
  y: number;
  fontFamily: string;
  fontSizeUser: number;
  fontWeight: 400 | 700;
  color: string;
};

type Frame = { x: number; y: number; width: number; height: number };

export type ExportPanel = {
  panelId: string;
  frame: Frame;
  label: ExportLabel | null;
} & (
  | {
      kind: "raster";
      png: Buffer;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "vector";
      normalizedSvg: string;
      x: number;
      y: number;
      scale: number;
    }
);

export function compileFigureSvg(input: {
  widthMm: number;
  heightMm: number;
  revision: number;
  includeMetadata: boolean;
  panels: ExportPanel[];
}): { svg: string; fontFamilies: string[] } {
  const width = formatSvgNumber(input.widthMm);
  const height = formatSvgNumber(input.heightMm);
  const clips = input.panels
    .map((panel) => {
      const id = `panel-${panel.panelId}-crop`;
      return `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="${formatSvgNumber(panel.frame.x)}" y="${formatSvgNumber(panel.frame.y)}" width="${formatSvgNumber(panel.frame.width)}" height="${formatSvgNumber(panel.frame.height)}"/></clipPath>`;
    })
    .join("");
  const groups = input.panels.map(renderPanel).join("");
  const metadata = input.includeMetadata
    ? `<metadata id="panelstudio-export">${escapeText(
        JSON.stringify({
          format: "panelstudio-svg",
          schemaVersion: SCHEMA_VERSION,
          revision: input.revision,
        }),
      )}</metadata>`
    : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
<defs>${clips}</defs>
${metadata}<rect id="canvas-background" x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>
${groups}</svg>
`;
  return { svg, fontFamilies: fontFamilies(svg, input.panels) };
}

function renderPanel(panel: ExportPanel): string {
  const content =
    panel.kind === "raster" ? renderRaster(panel) : renderVector(panel);
  const label = panel.label ? renderLabel(panel.panelId, panel.label) : "";
  return `<g id="panel-${panel.panelId}"><g id="panel-${panel.panelId}-content" clip-path="url(#panel-${panel.panelId}-crop)">${content}</g>${label}</g>`;
}

function renderRaster(panel: Extract<ExportPanel, { kind: "raster" }>): string {
  const href = `data:image/png;base64,${panel.png.toString("base64")}`;
  return `<image x="${formatSvgNumber(panel.x)}" y="${formatSvgNumber(panel.y)}" width="${formatSvgNumber(panel.width)}" height="${formatSvgNumber(panel.height)}" href="${href}" xlink:href="${href}"/>`;
}

function renderVector(panel: Extract<ExportPanel, { kind: "vector" }>): string {
  const fragment = instantiateSvg(panel.normalizedSvg, panel.panelId);
  return `<g transform="translate(${formatSvgNumber(panel.x)} ${formatSvgNumber(panel.y)}) scale(${formatSvgNumber(panel.scale)})">${fragment}</g>`;
}

function renderLabel(panelId: string, label: ExportLabel): string {
  return `<text id="panel-${panelId}-label" x="${formatSvgNumber(label.x)}" y="${formatSvgNumber(label.y)}" font-family="${escapeAttr(label.fontFamily)}" font-size="${formatSvgNumber(label.fontSizeUser)}" font-weight="${label.fontWeight}" fill="${escapeAttr(label.color)}">${escapeText(label.text)}</text>`;
}

function fontFamilies(svg: string, panels: ExportPanel[]): string[] {
  const families = new Set<string>();
  for (const panel of panels) {
    if (panel.label) families.add(panel.label.fontFamily);
  }
  for (const match of svg.matchAll(/font-family="([^"]+)"/gu)) {
    const value = match[1];
    if (!value) continue;
    for (const family of value.split(",")) {
      const name = family.trim().replace(/^'|'$/gu, "");
      if (name) families.add(name);
    }
  }
  return [...families];
}
