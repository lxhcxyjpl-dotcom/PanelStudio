import { AiTransportError } from "./errors.js";

// Only the public reply may be shown before the entire structured answer has been validated.
// Other property orders still work through the final, complete JSON response.
function visibleReply(raw: string): { text: string; closed: boolean } | undefined {
  const prefix = /^\s*(?:`{3}(?:json)?\s*)?\{\s*(?:(?:"(?:kind|intent)"\s*:\s*"[a-z]{1,20}"\s*,\s*){0,2})"reply"\s*:\s*"/iu.exec(raw);
  if (!prefix) return;
  const rest = raw.slice(prefix[0].length);
  const value = /^(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-f]{4}))*/iu.exec(rest)![0];
  const text: string = JSON.parse('"' + value + '"');
  return { text: text.replace(/[\uD800-\uDBFF]$/u, "").slice(0, 300), closed: rest[value.length] === '"' };
}

export async function readStreamedReply(response: Response, secret: string, publish: (text: string) => void, limit: number): Promise<string> {
  if (!response.body) throw new AiTransportError("The provider returned an empty stream.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", raw = "", previous = "", bytes = 0, finished = false, finalChunk = false, previewComplete = false;
  let data: string[] = [];
  function event() {
    const payload = data.join("\n");
    data = [];
    if (!payload) return;
    if (payload.trim() === "[DONE]") { finished = true; return; }
    const packet = JSON.parse(payload);
    if (packet.error) throw new AiTransportError("The provider interrupted the response.");
    const choice = packet.choices?.[0];
    if (choice?.finish_reason === "stop") finalChunk = true;
    if (typeof choice?.delta?.content !== "string") return;
    raw += choice.delta.content;
    if (raw.length > limit) throw new AiTransportError("The provider response was too large.");
    if (previewComplete || raw.length > 4096) return;
    const reply = visibleReply(raw);
    if (!reply) return;
    previewComplete = reply.closed;
    let safe = secret ? reply.text.split(secret).join("[redacted]") : reply.text;
    if (secret && !reply.closed) {
      // Hold a trailing key prefix until a later packet disambiguates it.
      for (let n = Math.min(safe.length, secret.length - 1); n > 0; n--) {
        if (safe.endsWith(secret.slice(0, n))) { safe = safe.slice(0, -n); break; }
      }
    }
    if (safe && safe !== previous) { previous = safe; publish(safe); }
  }
  function line(value: string) {
    if (!value) event();
    else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /u, ""));
  }
  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); if (buffer) line(buffer.replace(/\r$/u, "")); event(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > limit * 4) throw new AiTransportError("The provider stream was too large.");
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while (!finished && (end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/u, "")); buffer = buffer.slice(end + 1);
      }
    }
    if (!finished && !finalChunk) throw new AiTransportError("The provider stream was interrupted.");
    return secret ? raw.split(secret).join("[redacted]") : raw;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
