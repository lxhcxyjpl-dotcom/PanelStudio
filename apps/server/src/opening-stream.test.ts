import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createServer } from "./index.js";

it("sends only the public question as it arrives, commits validated options, and aborts the provider on stop", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "panelstudio-live-brief-"));
  const encode = new TextEncoder();
  let stream!: ReadableStreamDefaultController<Uint8Array>, upstream!: AbortSignal;
  let started!: () => void;
  const first = new Promise<void>(resolve => { started = resolve; });
  const app = createServer({ dataDir: dir, aiFetch: async (_url, init) => {
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true, thinking: { type: "disabled" } });
    upstream = init!.signal!;
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      upstream.addEventListener("abort", () => controller.error(upstream.reason), { once: true });
    } });
    started();
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }});
  const packet = (delta: Record<string,string>) => {
    const bytes = encode.encode("data: " + JSON.stringify({choices:[{delta}]}) + "\r\n\r\n");
    // Split inside UTF-8 sequences and SSE control lines.
    for (let i = 0; i < bytes.length; i += 9) stream.enqueue(bytes.slice(i, i + 9));
  };
  try {
    const cfg = await app.inject({ method:"PUT", url:"/api/v1/settings/ai-connection", headers:{"idempotency-key":randomUUID()},
      payload:{secret:"fixture-only-secret",config:{adapter:"openai-compatible",model:"deepseek-flash",baseUrl:"https://api.deepseek.com",allowLocalEndpoint:false,
        capabilities:{imageInput:false,structuredOutput:"json_object"}}} });
    expect(cfg.statusCode).toBe(200);
    const base = await app.listen({ host:"127.0.0.1", port:0 });
    const ask = (signal?: AbortSignal) => fetch(base + "/api/v1/figure-brief", { method:"POST", signal,
      headers:{ "content-type":"application/json", accept:"application/x-ndjson" },
      body:JSON.stringify({locale:"zh-CN",configRevision:cfg.json().configRevision,turns:[{role:"user",text:"怎么排？"}]}) });
    const request = ask();
    await first;
    packet({reasoning_content:"internal analysis"});
    packet({content:'{"reply":"想展示'});
    const response = await request, reader = response.body!.getReader(), decoder = new TextDecoder();
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const firstText = decoder.decode((await reader.read()).value, { stream: true });
    expect(firstText).toContain("想展示");
    expect(firstText).not.toContain("internal analysis");
    expect(firstText).not.toContain("options");
    packet({content:'哪组？","kind":"question","intent":"arrange","options":["对照","处理"],"request":"比较两组"}'});
    stream.enqueue(encode.encode("data: [DONE]\n\n")); stream.close();
    let lines = firstText;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; lines += decoder.decode(chunk.value, { stream:true }); }
    lines += decoder.decode();
    const events = lines.trim().split("\n").map(line => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type:"complete", result:{ reply:"想展示哪组？", options:["对照","处理"] } });

    const cancel = new AbortController(), previousSignal = upstream;
    const second = ask(cancel.signal);
    await expect.poll(() => upstream !== previousSignal).toBe(true);
    packet({ content:'{"reply":"正在' });
    const pending = await second;
    expect(pending.status).toBe(200);
    cancel.abort();
    await expect.poll(() => upstream.aborted).toBe(true);
  } finally {
    app.server.closeAllConnections();
    await app.close(); rmSync(dir, { recursive:true, force:true });
  }
}, 20000);
