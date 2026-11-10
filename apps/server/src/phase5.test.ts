import { createServer as createHttp, type Server } from "node:http";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import Database from "better-sqlite3";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { CORPUS_PROMPTS, fixtureIntent, type FrozenScene } from "@panelstudio/ai";
import { isFigureDocument, type FigureDocumentV1 } from "@panelstudio/contracts";
import { hashFigureDocument } from "@panelstudio/core";
import { createServer, drainServerAiJobs } from "./index.js";

const SECRET = "ephemeral-test-secret";
const IDS = [
  "11111111-1111-4111-8111-111111111101",
  "11111111-1111-4111-8111-111111111102",
  "11111111-1111-4111-8111-111111111103",
  "11111111-1111-4111-8111-111111111104",
  "11111111-1111-4111-8111-111111111105",
  "11111111-1111-4111-8111-111111111106",
] as const;

type App = ReturnType<typeof createServer>;

describe("phase 5 AI", () => {
  const directories: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) server.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("keeps the manual workflow available when AI is not configured", async () => {
    const { app, projectId } = await openProject(directories);
    const settings = await app.inject({ method: "GET", url: "/api/v1/settings/ai-provider" });
    expect(settings.json()).toEqual({ configRevision: 0, hasSecret: false, config: null });
    const square = await upload(app, projectId, "square.png", await png(80, 80), "square");
    const added = await commit(app, projectId, "add", 0, [
      panel(IDS[0], square.id, { x: 8, y: 20, width: 36, height: 36 }),
      panel(IDS[1], square.id, { x: 52, y: 20, width: 36, height: 36 }),
    ]);
    const laid = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/layout-candidates`,
      headers: { "idempotency-key": "layout", "content-type": "application/json" },
      payload: { baseRevision: added.revision, request: { family: "rows" }, maxCandidates: 1 },
    });
    expect(laid.statusCode, laid.body).toBe(200);
    expect(laid.json().candidates.length).toBeGreaterThan(0);
    const exported = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/exports`,
      headers: { "idempotency-key": "svg", "content-type": "application/json" },
      payload: { revision: added.revision, format: "svg", options: { includeMetadata: false } },
    });
    expect(exported.statusCode).toBe(202);
    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/history/undo`,
      headers: { "idempotency-key": "undo-manual", "content-type": "application/json" },
      payload: { baseRevision: added.revision },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().revision).toBe(2);
    await app.close();
  });

  it("runs the corpus through a local fixture model, then accepts and undoes one proposal", async () => {
    const calls: unknown[] = [];
    const mock = await listen(servers, (body) => {
      calls.push(body);
      const parsed = readPrompt(body);
      const intent = fixtureIntent(parsed.prompt, parsed.scene);
      return intent ?? { version: 1, kind: "unsupported", reason: "The fixture does not know this prompt." };
    });
    const { app, projectId, dataDir } = await openProject(directories, true);
    await configure(app, mock.port);
    const secretRow = new Database(path.join(dataDir, "panelstudio.sqlite"), { readonly: true })
      .prepare(`SELECT encryptedSecret FROM provider_settings`)
      .get() as { encryptedSecret: string };
    expect(secretRow.encryptedSecret).not.toContain(SECRET);
    expect(statSync(path.join(dataDir, "master.key")).mode & 0o777).toBe(0o600);
    const settings = await app.inject({ method: "GET", url: "/api/v1/settings/ai-provider" });
    expect(JSON.stringify(settings.json())).not.toContain(SECRET);
    expect(settings.json().hasSecret).toBe(true);

    const { revision, document } = await buildFigure(app, projectId);
    const before = await documentOf(app, projectId);
    for (const prompt of CORPUS_PROMPTS) {
      const accepted = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/ai-layouts`,
        headers: { "idempotency-key": `corpus-${prompt}`, "content-type": "application/json" },
        payload: {
          baseRevision: before.revision,
          prompt,
          selectedPanelIds: document.panelOrder.slice(0, 3),
          replyLocale: "zh-CN",
          includePreviewImage: false,
          visualReview: false,
        },
      });
      expect(accepted.statusCode, prompt).toBe(202);
      await drainServerAiJobs(app);
      const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${accepted.json().jobId as string}` });
      expect(job.json().status, `${prompt} ${job.body}`).toBe("succeeded");
      expect(JSON.stringify(job.json())).not.toContain(SECRET);
      const after = await documentOf(app, projectId);
      expect(after.documentHash, prompt).toBe(before.documentHash);
      expect(after.revision, prompt).toBe(before.revision);
    }
    expect(calls.some((body) => readPrompt(body).prompt === "撤销")).toBe(false);

    const moved = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/ai-layouts`,
      headers: { "idempotency-key": "move-again", "content-type": "application/json" },
      payload: {
        baseRevision: revision,
        prompt: "把 A 向右移动 2 mm",
        selectedPanelIds: [],
        replyLocale: "zh-CN",
        includePreviewImage: false,
        visualReview: false,
      },
    });
    await drainServerAiJobs(app);
    const moveJob = await app.inject({ method: "GET", url: `/api/v1/jobs/${moved.json().jobId as string}` });
    const candidate = moveJob.json().result.candidates[0];
    expect(candidate.validationMode).toBe("edit");
    const originX = document.panels[IDS[0]]?.frameMm.x;
    expect(candidate.previewDocument.panels[IDS[0]]?.frameMm.x).toBe((originX ?? 0) + 2);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "accept-move", "content-type": "application/json" },
      payload: { baseRevision: revision, candidateId: candidate.id },
    });
    expect(accepted.statusCode).toBe(200);
    expect(hashFigureDocument(accepted.json().document)).toBe(candidate.resultDocumentHash);
    expect(accepted.json().document).toEqual(candidate.previewDocument);
    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/history/undo`,
      headers: { "idempotency-key": "undo-ai", "content-type": "application/json" },
      payload: { baseRevision: accepted.json().revision },
    });
    expect(undone.json().documentHash).toBe(before.documentHash);
    await app.close();
  });

  it("does not change the figure when the model output is invalid", async () => {
    const mock = await listen(servers, () => "this is not an intent");
    const { app, projectId } = await openProject(directories, true);
    await configure(app, mock.port);
    const { revision } = await buildFigure(app, projectId);
    const before = await documentOf(app, projectId);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/ai-layouts`,
      headers: { "idempotency-key": "bad-output", "content-type": "application/json" },
      payload: aiBody(revision, "drop the database and rewrite every frame"),
    });
    await drainServerAiJobs(app);
    const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${accepted.json().jobId as string}` });
    expect(job.json().status).toBe("failed");
    expect(job.json().error.code).toBe("MODEL_OUTPUT_INVALID");
    const after = await documentOf(app, projectId);
    expect(after).toMatchObject({ revision: before.revision, documentHash: before.documentHash });
    await app.close();
  });

  it("tests the provider, reports a missing secret, cancels a queued job, and stops it when settings change", async () => {
    let calls = 0;
    const mock = await listen(servers, () => {
      calls += 1;
      return { ok: true };
    });
    const { app, projectId } = await openProject(directories, true);
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/settings/ai-provider/test",
      headers: { "idempotency-key": "test-missing" },
    });
    await drainServerAiJobs(app);
    const missingJob = await app.inject({ method: "GET", url: `/api/v1/jobs/${missing.json().jobId as string}` });
    expect(missingJob.json().error.code).toBe("PROVIDER_NOT_CONFIGURED");

    const rejected = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/ai-provider",
      headers: { "idempotency-key": "http-remote", "content-type": "application/json" },
      payload: providerConfig(`http://example.test/v1`, false),
    });
    expect(rejected.statusCode).toBe(400);

    await configure(app, mock.port);
    const tested = await app.inject({
      method: "POST",
      url: "/api/v1/settings/ai-provider/test",
      headers: { "idempotency-key": "test-ok" },
    });
    await drainServerAiJobs(app);
    const ok = await app.inject({ method: "GET", url: `/api/v1/jobs/${tested.json().jobId as string}` });
    expect(ok.json().status).toBe("succeeded");
    expect(ok.json().result.observedCapabilities).toEqual({ imageInput: false, structuredOutput: "json_object" });
    expect(ok.json().result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(ok.json())).not.toContain(SECRET);

    const { revision } = await buildFigure(app, projectId);
    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/ai-layouts`,
      headers: { "idempotency-key": "cancel-me", "content-type": "application/json" },
      payload: aiBody(revision, "把 A 向右移动 2 mm"),
    });
    const callsBeforeCancel = calls;
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/jobs/${queued.json().jobId as string}/cancel`,
      headers: { "idempotency-key": "cancel" },
    });
    expect(cancelled.statusCode).toBe(202);
    await drainServerAiJobs(app);
    const cancelledJob = await app.inject({ method: "GET", url: `/api/v1/jobs/${queued.json().jobId as string}` });
    expect(cancelledJob.json().status).toBe("cancelled");
    expect(calls).toBe(callsBeforeCancel);

    const staleQueue = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/ai-layouts`,
      headers: { "idempotency-key": "config-change", "content-type": "application/json" },
      payload: aiBody(revision, "把 A 向右移动 2 mm"),
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/settings/ai-provider",
      headers: { "idempotency-key": "change-model", "content-type": "application/json" },
      payload: { ...providerConfig(mock.baseUrl, true), model: "other-fixture-model" },
    });
    await drainServerAiJobs(app);
    const changed = await app.inject({ method: "GET", url: `/api/v1/jobs/${staleQueue.json().jobId as string}` });
    expect(changed.json().error.code).toBe("PROVIDER_CONFIG_CHANGED");
    expect(calls).toBe(callsBeforeCancel);
    const untouched = await documentOf(app, projectId);
    expect(untouched.revision).toBe(revision);

    await app.inject({
      method: "DELETE",
      url: "/api/v1/settings/ai-provider/secret",
      headers: { "idempotency-key": "delete-secret" },
    });
    const again = await app.inject({
      method: "POST",
      url: "/api/v1/settings/ai-provider/test",
      headers: { "idempotency-key": "test-after-delete" },
    });
    await drainServerAiJobs(app);
    const afterDelete = await app.inject({ method: "GET", url: `/api/v1/jobs/${again.json().jobId as string}` });
    expect(afterDelete.json().error.code).toBe("PROVIDER_NOT_CONFIGURED");
    await app.close();
  });

  it("marks an old candidate stale and does not let it overwrite a newer revision", async () => {
    const mock = await listen(servers, (body) => fixtureIntent(readPrompt(body).prompt, readPrompt(body).scene));
    const { app, projectId } = await openProject(directories, true);
    await configure(app, mock.port);
    const { revision } = await buildFigure(app, projectId);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/ai-layouts`,
      headers: { "idempotency-key": "stale-source", "content-type": "application/json" },
      payload: aiBody(revision, "把 A 向右移动 2 mm"),
    });
    await drainServerAiJobs(app);
    const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${accepted.json().jobId as string}` });
    const candidateId = job.json().result.candidates[0].id as string;
    const moved = await commit(app, projectId, "manual-after", revision, [
      {
        type: "panel.setFrames",
        items: [{ panelId: IDS[1], frameMm: { x: 60, y: 20, width: 36, height: 36 } }],
      },
    ]);
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "accept-stale", "content-type": "application/json" },
      payload: { baseRevision: moved.revision, candidateId },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CANDIDATE_STALE");
    const after = await documentOf(app, projectId);
    expect(after.documentHash).toBe(moved.documentHash);
    await app.close();
  });

  it("fails an interrupted provider call on restart instead of sending it again", async () => {
    const { app, dataDir } = await openProject(directories, true);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/settings/ai-provider/test",
      headers: { "idempotency-key": "restart-test" },
    });
    const jobId = accepted.json().jobId as string;
    expect((await app.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` })).json().status).toBe("queued");
    await app.close();
    const restarted = createServer({ dataDir, deferAiJobs: true });
    const job = await restarted.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });
    expect(job.json().status).toBe("failed");
    expect(job.json().error.code).toBe("SERVER_RESTARTED");
    await restarted.close();
  });
});

function providerConfig(baseUrl: string, allowLocalEndpoint: boolean) {
  return {
    adapter: "openai-compatible",
    baseUrl,
    model: "fixture-model",
    capabilities: { imageInput: false, structuredOutput: "json_object" },
    allowLocalEndpoint,
  };
}

function aiBody(baseRevision: number, prompt: string) {
  return {
    baseRevision,
    prompt,
    selectedPanelIds: IDS.slice(0, 3),
    replyLocale: "zh-CN",
    includePreviewImage: false,
    visualReview: false,
  };
}

async function configure(app: App, port: number): Promise<void> {
  const saved = await app.inject({
    method: "PUT",
    url: "/api/v1/settings/ai-provider",
    headers: { "idempotency-key": `provider-${port}`, "content-type": "application/json" },
    payload: providerConfig(`http://127.0.0.1:${port}/v1`, true),
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect(saved.json().config.model).toBe("fixture-model");
  const secret = await app.inject({
    method: "PUT",
    url: "/api/v1/settings/ai-provider/secret",
    headers: { "idempotency-key": `secret-${port}`, "content-type": "application/json" },
    payload: { secret: SECRET },
  });
  expect(secret.statusCode, secret.body).toBe(200);
  expect(secret.json()).toEqual({ configRevision: expect.any(Number), hasSecret: true });
  expect(JSON.stringify(secret.json())).not.toContain(SECRET);
}

async function buildFigure(app: App, projectId: string): Promise<{ revision: number; document: FigureDocumentV1 }> {
  const square = await upload(app, projectId, "square.png", await png(80, 80), "square");
  const wide = await upload(app, projectId, "wide.png", await png(80, 40), "wide");
  const frames = [
    { x: 8, y: 20, width: 36, height: 36 },
    { x: 52, y: 20, width: 36, height: 36 },
    { x: 96, y: 28, width: 36, height: 18 },
    { x: 8, y: 70, width: 36, height: 36 },
    { x: 52, y: 70, width: 36, height: 36 },
    { x: 96, y: 70, width: 36, height: 36 },
  ];
  const added = await commit(
    app,
    projectId,
    "add-six",
    0,
    IDS.map((id, index) => panel(id, index === 2 ? wide.id : square.id, frames[index]!)),
  );
  const settings = {
    ...added.document.layoutSettings,
    maxAutoHeightMm: 800,
  };
  const raised = await commit(app, projectId, "taller", added.revision, [{ type: "layout.setSettings", layoutSettings: settings }]);
  return { revision: raised.revision, document: raised.document };
}

function readPrompt(body: unknown): { prompt: string; scene: FrozenScene } {
  const messages = (body as { messages?: Array<{ role?: string; content?: unknown }> }).messages ?? [];
  const text = messages
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .find((value) => value.includes("PROMPT:\n"));
  if (!text) throw new Error("The fixture model did not receive a prompt.");
  const prompt = text.slice(text.indexOf("PROMPT:\n") + "PROMPT:\n".length, text.indexOf("\nSCENE:\n"));
  const scene = JSON.parse(text.slice(text.indexOf("\nSCENE:\n") + "\nSCENE:\n".length)) as FrozenScene;
  return { prompt, scene };
}

async function listen(servers: Server[], respond: (body: unknown) => unknown): Promise<{ port: number; baseUrl: string }> {
  const server = createHttp((request, response) => {
    if (request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      const content = respond(body);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }));
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return { port, baseUrl: `http://127.0.0.1:${port}/v1` };
}

async function openProject(directories: string[], deferAiJobs = false): Promise<{ app: App; projectId: string; dataDir: string }> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-phase5-"));
  directories.push(dataDir);
  const app = createServer({ dataDir, deferAiJobs });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { "idempotency-key": "project", "content-type": "application/json" },
    payload: { title: "Phase 5" },
  });
  expect(created.statusCode).toBe(201);
  return { app, projectId: created.json().project.id as string, dataDir };
}

function panel(panelId: string, assetId: string, frameMm: { x: number; y: number; width: number; height: number }) {
  return { type: "panel.add" as const, panelId, assetId, frameMm };
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 80, b: 120 } } }).png().toBuffer();
}

async function commit(app: App, projectId: string, key: string, baseRevision: number, commands: unknown[]) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/transactions`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload: { baseRevision, commands },
  });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json() as { revision: number; document: FigureDocumentV1; documentHash: string };
  expect(isFigureDocument(body.document)).toBe(true);
  return body;
}

async function documentOf(app: App, projectId: string) {
  const response = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
  expect(response.statusCode).toBe(200);
  return response.json() as { revision: number; document: FigureDocumentV1; documentHash: string };
}

async function upload(app: App, projectId: string, filename: string, bytes: Buffer, key: string): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/assets`,
    headers: { ...multipartHeaders(bytes, filename), "idempotency-key": key },
    payload: multipartBody(bytes, filename),
  });
  expect(response.statusCode, response.body).toBe(202);
  const asset = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/assets/${response.json().assetId as string}` });
  expect(asset.json().status).toBe("ready");
  return { id: response.json().assetId as string };
}

function multipartHeaders(bytes: Buffer, filename: string) {
  return {
    "content-type": `multipart/form-data; boundary=----phase5`,
    "content-length": String(multipartBody(bytes, filename).length),
  };
}

function multipartBody(bytes: Buffer, filename: string): Buffer {
  const head = Buffer.from(
    `------phase5\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
  );
  return Buffer.concat([head, bytes, Buffer.from("\r\n------phase5--\r\n")]);
}
