import { SPEECH_MAX_SECONDS, SPEECH_SAMPLE_RATE, supportsDeepSeekSpeech, type SpeechTranscript } from "@panelstudio/contracts";
import { readProvider } from "./db.js";
import { ApiException } from "./http.js";
import type { AppContext } from "./pipeline.js";
import { decryptSecret, masterKey } from "./secret.js";

const maxPcmBytes = SPEECH_SAMPLE_RATE * 2 * SPEECH_MAX_SECONDS;
export const maxSpeechBytes = maxPcmBytes + 4096;

function isDictationWav(wav: Buffer): boolean {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.readUInt32LE(4) !== wav.length - 8 || wav.toString("ascii", 8, 12) !== "WAVE") return false;
  let pcm = false, samples = 0;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const tag = wav.toString("ascii", pos, pos + 4), size = wav.readUInt32LE(pos + 4);
    const start = pos + 8;
    if (size > wav.length - start) return false;
    if (tag === "fmt ") {
      if (pcm || size < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 ||
          wav.readUInt32LE(start + 4) !== SPEECH_SAMPLE_RATE || wav.readUInt32LE(start + 8) !== SPEECH_SAMPLE_RATE * 2 ||
          wav.readUInt16LE(start + 12) !== 2 || wav.readUInt16LE(start + 14) !== 16) return false;
      pcm = true;
    }
    if (tag === "data") {
      if (!pcm || samples || !size || size % 2 || size > maxPcmBytes) return false;
      samples = size / 2;
    }
    pos = start + size + (size % 2);
  }
  return pcm && samples > 0;
}

export async function transcribeSpeech(ctx: AppContext, wav: unknown, signal: AbortSignal): Promise<SpeechTranscript> {
  if (!Buffer.isBuffer(wav) || !isDictationWav(wav))
    throw new ApiException("UNSUPPORTED_MEDIA_TYPE", "Expected a mono 16 kHz PCM WAV recording of up to 120 seconds.");
  const provider = readProvider(ctx.db);
  if (!provider?.encryptedSecret || !supportsDeepSeekSpeech(provider.config.baseUrl))
    throw new ApiException("PROVIDER_NOT_CONFIGURED", "Connect an official DeepSeek account to transcribe speech.", {}, 409);

  const body = new FormData();
  body.set("file", new Blob([Uint8Array.from(wav)], { type: "audio/wav" }), "dictation.wav");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(75_000)]);
  try {
    const response = await (ctx.aiFetch ?? fetch)("https://api.deepseek.com/v1/tools/asr", {
      method: "POST", body, redirect: "error", signal: deadline,
      headers: { Authorization: "Bearer " + decryptSecret(masterKey(ctx.dataDir), provider.encryptedSecret) },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = [400, 401, 402, 403, 413, 429, 503, 504].includes(response.status) ? response.status : 502;
      throw new ApiException("SPEECH_UNAVAILABLE", "The speech service could not transcribe this recording.", {}, status);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string")
      throw new ApiException("SPEECH_UNAVAILABLE", "The speech service returned an invalid transcript.");
    return { text: result.text.trim() };
  } catch (error) {
    if (error instanceof ApiException) throw error;
    throw new ApiException("SPEECH_UNAVAILABLE", "The speech service could not be reached.", {}, deadline.aborted ? 504 : 502);
  }
}
