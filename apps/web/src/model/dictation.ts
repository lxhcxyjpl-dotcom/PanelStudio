import { SPEECH_MAX_SECONDS, SPEECH_SAMPLE_RATE } from "@panelstudio/contracts";

/** The browser records in its native codec. Release the microphone before decoding or uploading. */
export async function captureDictation(signal: AbortSignal, onReady: (finish: () => void) => void): Promise<Blob> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof OfflineAudioContext === "undefined")
    throw new DOMException("Microphone recording is unavailable.", "NotSupportedError");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
  try {
    signal.throwIfAborted();
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    return await new Promise<Blob>((resolve, reject) => {
      const finish = () => { if (recorder.state === "recording") recorder.stop(); };
      const abort = () => { finish(); reject(signal.reason); };
      const tracks = stream.getAudioTracks();
      // Leave room for the codec's final frame at the provider's two-minute limit.
      const timer = window.setTimeout(finish, SPEECH_MAX_SECONDS * 1000 - 250);
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        tracks.forEach(track => track.removeEventListener("ended", finish));
      };
      recorder.onstart = () => { if (!signal.aborted) onReady(finish); };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => { cleanup(); resolve(new Blob(chunks, { type: recorder.mimeType })); };
      recorder.onerror = () => { cleanup(); reject(new DOMException("Recording was interrupted.", "NotReadableError")); };
      signal.addEventListener("abort", abort, { once: true });
      tracks.forEach(track => track.addEventListener("ended", finish, { once: true }));
      try { recorder.start(); }
      catch (error) { cleanup(); reject(error); }
    });
  } finally {
    stream.getTracks().forEach(track => track.stop());
  }
}

export async function dictationWav(recording: Blob): Promise<Blob> {
  if (!recording.size) throw new DOMException("Empty audio.", "NoSpeechError");
  const decoder = new OfflineAudioContext(1, 1, SPEECH_SAMPLE_RATE);
  const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
  const samples = decoded.getChannelData(0).subarray(0, SPEECH_SAMPLE_RATE * SPEECH_MAX_SECONDS);
  if (!samples.some(sample => Math.abs(sample) > 0.001))
    throw new DOMException("No sound was captured.", "NoSpeechError");

  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  function label(at: number, text: string) {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  }
  label(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); label(8, "WAVE");
  label(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_SAMPLE_RATE, true); view.setUint32(28, SPEECH_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  });
  return new Blob([bytes], { type: "audio/wav" });
}

export function insertDictation(value: string, start: number, end: number, text: string) {
  const before = value.slice(0, start), after = value.slice(end);
  const leading = /[a-z0-9]$/i.test(before) && /^[a-z0-9]/i.test(text) ? " " : "";
  const trailing = /[a-z0-9]$/i.test(text) && /^[a-z0-9]/i.test(after) ? " " : "";
  const insert = leading + text + trailing;
  return { value: before + insert + after, caret: before.length + insert.length };
}
