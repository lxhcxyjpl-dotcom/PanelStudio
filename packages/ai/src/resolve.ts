import { RESOURCE_LIMITS, type AIIntent, type AIProviderConfig } from "@panelstudio/contracts";
import { postChatCompletion, pngDataUrl, type ChatMessage } from "./adapter.js";
import { AiTransportError } from "./errors.js";
import { parseModelJson, validateIntent } from "./parse.js";
import { systemPrompt, userPrompt } from "./prompt.js";
import type { FrozenScene } from "./scene.js";

export type IntentResolution =
  | { ok: true; intent: AIIntent; calls: number }
  | { ok: false; code: "MODEL_OUTPUT_INVALID"; message: string; calls: number };

export async function resolveModelIntent(input: {
  config: AIProviderConfig;
  secret: string;
  prompt: string;
  scene: FrozenScene;
  replyLocale: string;
  previewPng?: Uint8Array | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<IntentResolution> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.config, input.replyLocale) },
    { role: "user", content: userContent(userPrompt(input.prompt, input.scene), input.previewPng) },
  ];
  const first = await postChatCompletion({
    config: input.config,
    secret: input.secret,
    messages,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const parsed = readIntent(first);
  if (parsed.ok) return { ok: true, intent: parsed.intent, calls: 1 };
  if (RESOURCE_LIMITS.aiModelCallBudget < 2) {
    return { ok: false, code: "MODEL_OUTPUT_INVALID", message: parsed.message, calls: 1 };
  }
  messages.push({ role: "assistant", content: first.slice(0, 2_000) });
  messages.push({
    role: "user",
    content: `The previous output was not a valid AIIntent. ${parsed.message} Return only the corrected JSON object.`,
  });
  const second = await postChatCompletion({
    config: input.config,
    secret: input.secret,
    messages,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const repaired = readIntent(second);
  if (repaired.ok) return { ok: true, intent: repaired.intent, calls: 2 };
  return { ok: false, code: "MODEL_OUTPUT_INVALID", message: repaired.message, calls: 2 };
}

export async function reviewModelIntent(input: {
  config: AIProviderConfig;
  secret: string;
  scene: FrozenScene;
  prompt: string;
  candidateScene: FrozenScene;
  replyLocale: string;
  proposalJson: string;
  previewPng: Uint8Array;
  inputPng: Uint8Array;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ ok: true; intent: AIIntent } | { ok: false; message: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(input.config, input.replyLocale) },
    {
      role: "user",
      content: [
        { type: "text", text: `Review this proposal against the user's request, prior turns, and frozen scope. Return one AIIntent.\n${userPrompt(input.prompt, input.scene)}\nPROPOSAL:\n${input.proposalJson}\nCANDIDATE SCENE:\n${JSON.stringify(input.candidateScene)}\nInput draft before this turn:` },
        { type: "image_url", image_url: { url: pngDataUrl(input.inputPng) } },
        { type: "text", text: "Candidate after this turn:" },
        { type: "image_url", image_url: { url: pngDataUrl(input.previewPng) } },
      ],
    },
  ];
  const content = await postChatCompletion({
    config: input.config,
    secret: input.secret,
    messages,
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  return readIntent(content);
}

function userContent(text: string, previewPng: Uint8Array | null | undefined): ChatMessage["content"] {
  if (!previewPng || previewPng.byteLength === 0) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: pngDataUrl(previewPng) } },
  ];
}

function readIntent(content: string): { ok: true; intent: AIIntent } | { ok: false; message: string } {
  try {
    return validateIntent(parseModelJson(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model output is not JSON.";
    return { ok: false, message };
  }
}

export function transportMessage(error: unknown): string {
  if (error instanceof AiTransportError) return error.message;
  return "The provider request failed.";
}
