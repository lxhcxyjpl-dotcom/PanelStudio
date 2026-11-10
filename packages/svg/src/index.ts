import { ENGINE_VERSIONS, SVG_SUPPORT } from "@panelstudio/contracts";

export const SVG_PHASE = 1 as const;

export const svgEngineVersion = ENGINE_VERSIONS.svg;

export const svgSupportCatalogVersion = SVG_SUPPORT.catalogVersion;

export { compileFigureSvg } from "./compile.js";
export type { ExportLabel, ExportPanel } from "./compile.js";
export { SvgImportError } from "./errors.js";
export { instancePrefix, instantiateSvg } from "./instantiate.js";
export { normalizeSvg, normalizationVersion } from "./normalize.js";
export type { NormalizedSvg } from "./normalize.js";
export { formatSvgNumber } from "./number.js";
export { parseSvgDocument } from "./xml.js";
