import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isFigureDocument, type FigureDocumentV1 } from "@panelstudio/contracts";
import { framesNearlyEqual } from "@panelstudio/core";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./index.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-111111111112";
const C = "11111111-1111-4111-8111-111111111113";
const ROW = "44444444-4444-4444-8444-444444444441";
const EQUAL = "44444444-4444-4444-8444-444444444442";

type App = ReturnType<typeof createServer>;

type CandidateBody = {
  id: string;
  summary: string;
  commands: Array<{ type: string }>;
  previewDocument: FigureDocumentV1;
  resultDocumentHash: string;
  diagnostics: Array<{ severity: string; code: string }>;
};

type TransactionBody = {
  revision: number;
  changed: boolean;
  document: FigureDocumentV1;
  documentHash: string;
  history: { canUndo: boolean; canRedo: boolean };
};

describe("phase 3 automatic layout", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("previews a candidate without saving, then accepts it and undoes it", async () => {
    const { app, projectId } = await openProject(directories);
    const wide = await upload(app, projectId, "wide.png", await png(200, 100), "wide");
    const square = await upload(app, projectId, "square.png", await png(120, 120), "square");
    const tall = await upload(app, projectId, "tall.png", await png(80, 160), "tall");
    const added = await commit(app, projectId, "add", 0, [
      panel(A, wide.id, { x: 10, y: 20, width: 60, height: 30 }),
      panel(B, square.id, { x: 80, y: 20, width: 36, height: 36 }),
      panel(C, tall.id, { x: 130, y: 20, width: 24, height: 48 }),
    ]);
    const room = await commit(app, projectId, "room", added.revision, [
      {
        type: "layout.setSettings",
        layoutSettings: { ...added.document.layoutSettings, maxAutoHeightMm: 400 },
      },
    ]);
    const before = await documentOf(app, projectId);
    expect(before.revision).toBe(room.revision);
    expect(before.documentHash).toBe(room.documentHash);

    const listed = await layout(app, projectId, "layout-auto", before.revision, { family: "auto", primaryPanelId: B });
    expect(listed.statusCode).toBe(200);
    const candidates = listed.json().candidates as CandidateBody[];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(new Set(candidates.map((candidate) => candidate.resultDocumentHash)).size).toBe(candidates.length);
    expect(candidates.some((candidate) => candidate.summary.startsWith("均衡分行"))).toBe(true);
    expect(candidates.some((candidate) => candidate.summary.startsWith("主图"))).toBe(true);
    for (const candidate of candidates) {
      expect(candidate.previewDocument.canvas.widthMm).toBeGreaterThan(0);
      expect(candidate.commands.every((command) => command.type === "panel.setFrames" || command.type === "canvas.set")).toBe(true);
      expect(isFigureDocument(candidate.previewDocument)).toBe(true);
    }
    const replay = await layout(app, projectId, "layout-auto", before.revision, { family: "auto", primaryPanelId: B });
    expect(replay.json().candidates).toEqual(candidates);
    const again = await layout(app, projectId, "layout-auto-2", before.revision, { family: "auto", primaryPanelId: B });
    expect(again.json().candidates.map((candidate: CandidateBody) => candidate.id)).toEqual(candidates.map((candidate) => candidate.id));

    const chosen = candidates[0];
    if (!chosen) throw new Error("missing candidate");
    const fetched = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/candidates/${chosen.id}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(chosen);

    const preview = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/previews`,
      headers: { "idempotency-key": "preview", "content-type": "application/json" },
      payload: { source: { candidateId: chosen.id }, pixelWidth: 320 },
    });
    expect(preview.statusCode).toBe(202);
    const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${preview.json().jobId as string}` });
    expect(job.json().status).toBe("succeeded");
    const artifactId = job.json().result.artifactId as string;
    const image = await app.inject({ method: "GET", url: `/api/v1/artifacts/${artifactId}/download` });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toContain("image/png");
    expect(image.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const untouched = await documentOf(app, projectId);
    expect(untouched.revision).toBe(before.revision);
    expect(untouched.documentHash).toBe(before.documentHash);
    expect(untouched.document).toEqual(before.document);

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "accept", "content-type": "application/json" },
      payload: { baseRevision: before.revision, candidateId: chosen.id },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const body = accepted.json() as TransactionBody;
    expect(body.changed).toBe(true);
    expect(body.revision).toBe(before.revision + 1);
    expect(body.history).toEqual({ canUndo: true, canRedo: false });
    expect(body.documentHash).toBe(chosen.resultDocumentHash);
    for (const panelId of body.document.panelOrder) {
      expect(framesNearlyEqual(body.document.panels[panelId]?.frameMm ?? { x: 0, y: 0, width: 1, height: 1 }, chosen.previewDocument.panels[panelId]?.frameMm ?? { x: 1, y: 1, width: 1, height: 1 })).toBe(true);
    }
    expect(body.document.canvas).toEqual(chosen.previewDocument.canvas);

    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/history/undo`,
      headers: { "idempotency-key": "undo-layout", "content-type": "application/json" },
      payload: { baseRevision: body.revision },
    });
    expect(undone.statusCode).toBe(200);
    const restored = undone.json() as TransactionBody;
    expect(restored.documentHash).toBe(before.documentHash);
    expect(restored.document).toEqual(before.document);
    expect(restored.history.canRedo).toBe(true);

    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "stale-accept", "content-type": "application/json" },
      payload: { baseRevision: restored.revision, candidateId: chosen.id },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CANDIDATE_STALE");
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "missing-candidate", "content-type": "application/json" },
      payload: { baseRevision: restored.revision, candidateId: "99999999-9999-4999-8999-999999999999" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns LAYOUT_CONFLICT for a locked panel and for unsatisfiable hard constraints", async () => {
    const { app, projectId } = await openProject(directories);
    const wide = await upload(app, projectId, "wide.png", await png(200, 100), "wide");
    const square = await upload(app, projectId, "square.png", await png(100, 100), "square");
    const added = await commit(app, projectId, "add", 0, [
      panel(A, wide.id, { x: 30, y: 30, width: 40, height: 20 }),
      panel(B, square.id, { x: 90, y: 28, width: 36, height: 36 }),
    ]);
    const locked = await commit(app, projectId, "lock", added.revision, [{ type: "panel.setLocked", panelIds: [A], locked: true }]);
    const conflict = await layout(app, projectId, "locked-layout", locked.revision, { family: "rows" });
    expect(conflict.statusCode).toBe(422);
    expect(conflict.json().error.code).toBe("LAYOUT_CONFLICT");
    expect(conflict.json().error.details.panelIds).toContain(A);
    const unchanged = await documentOf(app, projectId);
    expect(unchanged.revision).toBe(locked.revision);
    expect(unchanged.document.panels[A]?.locked).toBe(true);

    const unlocked = await commit(app, projectId, "unlock", locked.revision, [{ type: "panel.setLocked", panelIds: [A], locked: false }]);
    const settings = {
      ...unlocked.document.layoutSettings,
      constraints: [
        { id: ROW, kind: "row" as const, panelIds: [A, B] },
        { id: EQUAL, kind: "equalWidth" as const, panelIds: [A, B] },
      ],
    };
    const constrained = await commit(app, projectId, "constraints", unlocked.revision, [
      { type: "layout.setSettings", layoutSettings: settings },
    ]);
    const hard = await layout(app, projectId, "hard-layout", constrained.revision, { family: "auto" });
    expect(hard.statusCode).toBe(422);
    expect(hard.json().error.code).toBe("LAYOUT_CONFLICT");
    expect(hard.json().error.details.constraintIds).toEqual(expect.arrayContaining([ROW, EQUAL]));
    const still = await documentOf(app, projectId);
    expect(still.documentHash).toBe(constrained.documentHash);
    await app.close();
  });
});

async function openProject(directories: string[]): Promise<{ app: App; projectId: string }> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-phase3-"));
  directories.push(dataDir);
  const app = createServer({ dataDir });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { "idempotency-key": "project", "content-type": "application/json" },
    payload: { title: "Phase 3" },
  });
  expect(created.statusCode).toBe(201);
  return { app, projectId: created.json().project.id as string };
}

function panel(panelId: string, assetId: string, frameMm: { x: number; y: number; width: number; height: number }) {
  return { type: "panel.add" as const, panelId, assetId, frameMm };
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 140 } } }).png().toBuffer();
}

async function commit(app: App, projectId: string, key: string, baseRevision: number, commands: unknown[]): Promise<TransactionBody> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/transactions`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload: { baseRevision, commands },
  });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json() as TransactionBody;
  expect(isFigureDocument(body.document)).toBe(true);
  return body;
}

async function documentOf(app: App, projectId: string): Promise<{ revision: number; document: FigureDocumentV1; documentHash: string }> {
  const response = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
  expect(response.statusCode).toBe(200);
  return response.json() as { revision: number; document: FigureDocumentV1; documentHash: string };
}

async function layout(app: App, projectId: string, key: string, baseRevision: number, request: unknown) {
  return app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/layout-candidates`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload: { baseRevision, request },
  });
}

async function upload(app: App, projectId: string, filename: string, bytes: Buffer, key: string): Promise<{ id: string }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/assets`,
    headers: { "idempotency-key": key, ...multipartHeaders(bytes, filename, "image/png") },
    payload: multipartBody(bytes, filename, "image/png"),
  });
  expect(response.statusCode).toBe(202);
  const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${response.json().jobId as string}` });
  expect(job.json().status).toBe("succeeded");
  return { id: response.json().assetId as string };
}

function multipartHeaders(bytes: Buffer, filename: string, mediaType: string) {
  return {
    "content-type": "multipart/form-data; boundary=----panelstudio",
    "content-length": String(multipartBody(bytes, filename, mediaType).byteLength),
  };
}

function multipartBody(bytes: Buffer, filename: string, mediaType: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `------panelstudio\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n------panelstudio--\r\n"),
  ]);
}
