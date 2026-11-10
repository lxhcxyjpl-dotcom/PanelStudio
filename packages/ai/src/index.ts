import { AI_ADAPTER_ID, RESOURCE_LIMITS } from "@panelstudio/contracts";

export const AI_PHASE = 5 as const;

export const aiAdapterId = AI_ADAPTER_ID;

export const aiModelCallBudget = RESOURCE_LIMITS.aiModelCallBudget;

export { postChatCompletion, pngDataUrl } from "./adapter.js";
export type { ChatMessage } from "./adapter.js";
export { compileProposal } from "./compile.js";
export type { CompileResult } from "./compile.js";
export { CORPUS_PROMPTS, fixtureIntent } from "./corpus-fixture.js";
export { isDirectUndo } from "./direct.js";
export { chatCompletionsUrl, endpointProblem } from "./endpoint.js";
export { AiCompileError, AiTransportError } from "./errors.js";
export { parseModelJson, validateIntent } from "./parse.js";
export { systemPrompt, userPrompt } from "./prompt.js";
export { resolveModelIntent, reviewModelIntent, transportMessage } from "./resolve.js";
export { buildScene, sceneText } from "./scene.js";
export type { FrozenScene } from "./scene.js";
