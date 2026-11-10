import { SCHEMA_VERSION } from "@panelstudio/contracts";

export const CORE_PHASE = 1 as const;

/** Binds this package to the shared schema version without defining a document model. */
export const boundSchemaVersion: typeof SCHEMA_VERSION = SCHEMA_VERSION;

export { DocumentCommandError, applyCommands, assertFigureDocument } from "./apply.js";
export type { AssetLookup, ReadyAssetFacts } from "./apply.js";
export {
  CROP_EDGE_EPSILON,
  aspectMatches,
  aspectScales,
  contentPlacement,
  cropIsInsideUnitSquare,
  rectIsOnCanvas,
} from "./geometry.js";
export { canonicalJson, hashFigureDocument, sha256 } from "./hash.js";
export {
  INHERITED_LABEL_OVERRIDES,
  LABEL_EM_ADVANCE,
  LABEL_EM_ASCENT,
  LABEL_EM_DESCENT,
  fontFamilyForId,
  labelIsVisible,
  resolvePanelLabel,
} from "./labels.js";
export type { Rect, ResolvedLabel } from "./labels.js";
