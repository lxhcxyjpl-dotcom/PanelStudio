import Type, { type Static } from "typebox";
import { object } from "./schema.js";

export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_MAX_SECONDS = 120;
export const SpeechTranscriptSchema = object({ text: Type.String() });
export type SpeechTranscript = Static<typeof SpeechTranscriptSchema>;

/** Only the official DeepSeek connection can authenticate the separate speech tool. */
export function supportsDeepSeekSpeech(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl);
    return url.origin === "https://api.deepseek.com" && !url.username && !url.password &&
      !url.search && !url.hash && ["", "/v1", "/chat/completions", "/v1/chat/completions"].includes(url.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}
