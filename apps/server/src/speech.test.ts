import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { SPEECH_SAMPLE_RATE, supportsDeepSeekSpeech } from "@panelstudio/contracts";
import { createServer } from "./index.js";

function recording(rate = SPEECH_SAMPLE_RATE) {
  const wav = Buffer.alloc(48);
  wav.write("RIFF"); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(4, 40);
  return wav;
}

it("only transcribes valid audio for the connected official account, without adding a project or sending a chat", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "panelstudio-speech-"));
  const wav = recording();
  let response = () => Response.json({ text: " 图宽 85 毫米。 " });
  const upstream = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe("https://api.deepseek.com/v1/tools/asr");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
    const form = init?.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    expect(Buffer.from(await (form.get("file") as File).arrayBuffer())).toEqual(wav);
    return response();
  });
  const app = createServer({ dataDir: dir, aiFetch: upstream });
  const upload = (payload: Buffer) => app.inject({ method: "POST", url: "/api/v1/speech/transcriptions", headers: { "content-type": "audio/wav" }, payload });
  const connect = (baseUrl: string) => app.inject({ method: "PUT", url: "/api/v1/settings/ai-connection",
    headers: { "idempotency-key": randomUUID() }, payload: { secret: "fixture-key",
      config: { adapter: "openai-compatible", baseUrl, model: "fixture", allowLocalEndpoint: false, capabilities: { imageInput: false, structuredOutput: "json_object" } } } });
  try {
    expect((await upload(wav)).statusCode).toBe(409);
    expect((await connect("https://model.example/v1")).statusCode).toBe(200);
    expect((await upload(wav)).statusCode).toBe(409);
    expect((await connect("https://api.deepseek.com/v1")).statusCode).toBe(200);
    expect((await upload(Buffer.from("not audio"))).statusCode).toBe(415);
    expect((await upload(recording(44100))).statusCode).toBe(415);
    expect((await upload(Buffer.alloc(4_000_000))).statusCode).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
    expect((await upload(wav)).json()).toEqual({ text: "图宽 85 毫米。" });
    response = () => Response.json({ text: "" });
    expect((await upload(wav)).json()).toEqual({ text: "" });
    response = () => new Response("private upstream detail", { status: 429 });
    const throttled = await upload(wav);
    expect(throttled.statusCode).toBe(429);
    expect(throttled.body).not.toContain("private upstream detail");
    response = () => Response.json({ invalid: true });
    expect((await upload(wav)).statusCode).toBe(502);
    expect((await app.inject({ url: "/api/v1/projects" })).json().items).toHaveLength(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("identifies DeepSeek by its actual configured endpoint", () => {
  expect(supportsDeepSeekSpeech("https://api.deepseek.com/")).toBe(true);
  expect(supportsDeepSeekSpeech("https://api.deepseek.com/v1/chat/completions")).toBe(true);
  for (const url of ["http://api.deepseek.com", "https://api.deepseek.com.example/v1", "https://api.deepseek.com/proxy", "https://api.deepseek.com:9443/v1"])
    expect(supportsDeepSeekSpeech(url)).toBe(false);
});
