import { ENGINE_VERSIONS } from "@panelstudio/contracts";

export const LAYOUT_PHASE = 3 as const;

export const layoutEngineVersion = ENGINE_VERSIONS.layout;

export { solveLayout } from "./solve.js";
export type { LayoutAssetFacts, SolveLayoutFailure, SolveLayoutInput, SolveLayoutResult, SolvedCandidate } from "./solve.js";
