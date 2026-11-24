import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { createServer } from "./index.js";

it("opens a text-only conversation without creating a project and carries the chosen answer forward", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "panelstudio-opening-")),
    sent: string[] = [];
  let answer = {
    kind: "question",
    intent: "select",
    reply: "Which comparison should the figure emphasize?",
    options: ["Compare conditions", "Compare time points"],
    request: "Help choose figures.",
  };
  const app = createServer({
    dataDir: dir,
    aiFetch: async (_url, init) => {
      const wire = JSON.parse(String(init?.body));
      expect(typeof wire.messages[1].content).toBe("string");
      expect(wire.messages[0].content).toContain('"options"');
      sent.push(wire.messages[1].content);
      return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
    },
  });
  try {
    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/ai-connection",
      headers: { "idempotency-key": randomUUID() },
      payload: {
        config: {
          adapter: "openai-compatible",
          model: "fixture",
          baseUrl: "http://127.0.0.1:1/v1",
          allowLocalEndpoint: true,
          capabilities: { imageInput: true, structuredOutput: "json_object" },
        },
        secret: "fixture-only",
      },
    });
    expect(saved.statusCode).toBe(200);
    const req = {
      turns: [{ role: "user", text: "Help me choose." }],
      locale: "en-US",
      configRevision: saved.json().configRevision,
      brief: "",
    };
    const ask = (payload: unknown) =>
      app.inject({
        method: "POST",
        url: "/api/v1/figure-brief",
        payload: payload as Record<string, unknown>,
      });
    expect((await ask({ ...req, configRevision: 99 })).statusCode).toBe(409);
    expect(sent).toHaveLength(0);
    expect((await ask(req)).json()).toEqual(answer);
    req.turns.push({ role: "assistant", text: answer.reply }, { role: "user", text: "Compare time points" });
    req.brief = answer.request;
    answer = {
      kind: "ready",
      intent: "select",
      reply: "Attach the time-course panels for Fig. 2.",
      options: [],
      request: "Choose panels comparing the time points.",
    };
    expect((await ask(req)).json()).toEqual(answer);
    expect(JSON.parse(sent[1]!).turns.at(-1).text).toBe("Compare time points");
    expect((await app.inject({ url: "/api/v1/projects" })).json().items).toHaveLength(0);
    answer = { ...answer, kind: "question", options: [] };
    expect((await ask(req)).statusCode).toBe(422);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
