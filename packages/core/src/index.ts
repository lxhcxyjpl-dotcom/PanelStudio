import { SCHEMA_VERSION } from "@panelstudio/contracts";

export const CORE_PHASE = 2 as const;

/** Binds this package to the shared schema version without defining a document model. */
export const boundSchemaVersion: typeof SCHEMA_VERSION = SCHEMA_VERSION;

export { DocumentCommandError, applyCommands, assertFigureDocument } from "./apply.js";
export type { AssetLookup, ReadyAssetFacts } from "./apply.js";
export {
  alignSelection,
  distributeSelection,
  equalSizeSelection,
  scalePanel,
  translateSelection,
} from "./arrange.js";
export type { ManualAlignReference } from "./arrange.js";
export {
  CROP_EDGE_EPSILON,
  aspectMatches,
  aspectScales,
  contentPlacement,
  cropIsInsideUnitSquare,
  cropsNearlyEqual,
  fitFrameContain,
  frameAfterCrop,
  framesNearlyEqual,
  nearlyEqualMm,
  rectIsOnCanvas,
  scaleFrame,
  translateFrame,
} from "./geometry.js";
export type { FrameAnchor } from "./geometry.js";
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
export { movedStackOrder, stackOrderCommand } from "./stack.js";
export type { StackMove } from "./stack.js";
