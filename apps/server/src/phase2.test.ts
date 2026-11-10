import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isFigureDocument, type FigureDocumentV1 } from "@panelstudio/contracts";
import {
  alignSelection,
  distributeSelection,
  equalSizeSelection,
  translateSelection,
} from "@panelstudio/core";
import Database from "better-sqlite3";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./index.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-111111111112";
const C = "11111111-1111-4111-8111-111111111113";
const GROUP = "33333333-3333-4333-8333-333333333333";

type App = ReturnType<typeof createServer>;

type TransactionBody = {
  revision: number;
  changed: boolean;
  document: FigureDocumentV1;
  documentHash: string;
  history: { canUndo: boolean; canRedo: boolean };
};

describe("phase 2 edit kernel", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("restores document state, crop, frames, and undo history from the same files", async () => {
    const wide = await png(80, 40, { r: 20, g: 80, b: 160 });
    const square = await png(40, 40, { r: 200, g: 40, b: 40 });
    const { app, projectId, dataDir } = await openProject();
    const emptyUndo = await history(app, projectId, "undo", "early-undo", 0);
    expect(emptyUndo.statusCode).toBe(400);
    expect(emptyUndo.json().error.code).toBe("REQUEST_INVALID");

    const wideAsset = await upload(app, projectId, "wide.png", wide, "wide");
    const squareAsset = await upload(app, projectId, "square.png", square, "square");
    const added = await commit(app, projectId, "add", 0, [
      panel(A, wideAsset.id, { x: 10, y: 20, width: 40, height: 20 }),
      panel(B, squareAsset.id, { x: 70, y: 20, width: 30, height: 30 }),
    ]);
    expect(added.revision).toBe(1);
    expect(added.history).toEqual({ canUndo: true, canRedo: false });
    const staleUndo = await history(app, projectId, "undo", "early-undo", 0);
    expect(staleUndo.statusCode).toBe(409);
    expect(staleUndo.json().error.code).toBe("REVISION_CONFLICT");

    const noop = await commit(app, projectId, "noop", 1, [
      {
        type: "panel.setFrames",
        items: [
          { panelId: A, frameMm: { x: 10, y: 20, width: 40, height: 20 } },
          { panelId: B, frameMm: { x: 70, y: 20, width: 30, height: 30 } },
        ],
      },
    ]);
    expect(noop.changed).toBe(false);
    expect(noop.revision).toBe(1);
    expect(noop.history.canUndo).toBe(true);

    const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
    const cropped = await commit(app, projectId, "crop", 1, [{ type: "panel.setCrop", panelId: A, cropNormalized: crop }]);
    expect(cropped.revision).toBe(2);
    expect(cropped.changed).toBe(true);
    expect(cropped.document.panels[A]?.frameMm).toEqual({ x: 20, y: 20, width: 20, height: 20 });
    expect(cropped.document.panels[A]?.cropNormalized).toEqual(crop);
    const replay = await commit(app, projectId, "crop", 1, [{ type: "panel.setCrop", panelId: A, cropNormalized: crop }]);
    expect(replay.revision).toBe(2);
    const reusedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "crop", "content-type": "application/json" },
      payload: {
        baseRevision: 2,
        commands: [{ type: "panel.setFrames", items: [{ panelId: B, frameMm: { x: 80, y: 20, width: 30, height: 30 } }] }],
      },
    });
    expect(reusedResponse.statusCode).toBe(409);
    expect(reusedResponse.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await original(app, projectId, wideAsset.id)).toEqual(wide);
    expect(await original(app, projectId, squareAsset.id)).toEqual(square);

    const undone = await history(app, projectId, "undo", "undo-crop", 2);
    expect(undone.statusCode).toBe(200);
    const undoneBody = undone.json() as TransactionBody;
    expect(undoneBody.revision).toBe(3);
    expect(undoneBody.documentHash).toBe(added.documentHash);
    expect(undoneBody.document.panels[A]?.frameMm).toEqual({ x: 10, y: 20, width: 40, height: 20 });
    expect(undoneBody.document.panels[A]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(undoneBody.history).toEqual({ canUndo: true, canRedo: true });
    const undoReplay = await history(app, projectId, "undo", "undo-crop", 2);
    expect(undoReplay.statusCode).toBe(200);
    expect((undoReplay.json() as TransactionBody).revision).toBe(3);

    const conflict = await history(app, projectId, "undo", "stale-undo", 2);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("REVISION_CONFLICT");
    const redone = await history(app, projectId, "redo", "redo-crop", 3);
    expect(redone.statusCode).toBe(200);
    const redoneBody = redone.json() as TransactionBody;
    expect(redoneBody.revision).toBe(4);
    expect(redoneBody.document.panels[A]?.cropNormalized).toEqual(crop);
    expect(redoneBody.documentHash).toBe(cropped.documentHash);
    const moved = await commit(app, projectId, "after-undo", redoneBody.revision, [
      translateSelection(redoneBody.document, [B], 2, 0),
    ]);
    expect(moved.revision).toBe(5);
    const blockedRedo = await history(app, projectId, "redo", "redo-gone", moved.revision);
    expect(blockedRedo.statusCode).toBe(400);
    expect(blockedRedo.json().error.code).toBe("REQUEST_INVALID");

    const beforeClose = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
    expect(beforeClose.statusCode).toBe(200);
    const saved = beforeClose.json() as TransactionBody & { projectId: string };
    expect(isFigureDocument(saved.document)).toBe(true);
    await app.close();

    const stored = readHistory(dataDir);
    expect(stored.currentRevision).toBe(saved.revision);
    expect(stored.rows.map((row) => row.kind)).toEqual(["create", "transaction", "transaction", "undo", "redo", "transaction"]);
    const undoRow = stored.rows.find((row) => row.kind === "undo");
    expect(undoRow?.commandsJson).toBe("[]");
    expect(undoRow?.targetRevision).toBe(1);
    expect(undoRow?.documentHash).toBe(added.documentHash);
    expect(stored.rows[1]?.documentHash).toBe(added.documentHash);

    const reopened = createServer({ dataDir });
    const restored = await reopened.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      projectId,
      revision: saved.revision,
      documentHash: saved.documentHash,
      history: saved.history,
    });
    expect(await original(reopened, projectId, wideAsset.id)).toEqual(wide);
    expect(await original(reopened, projectId, squareAsset.id)).toEqual(square);
    const restoredUndo = await history(reopened, projectId, "undo", "undo-after-restart", saved.revision);
    expect(restoredUndo.statusCode).toBe(200);
    expect((restoredUndo.json() as TransactionBody).document.panels[B]?.frameMm.x).toBe(70);
    expect(await original(reopened, projectId, wideAsset.id)).toEqual(wide);
    await reopened.close();
  });

  it("commits align, distribute, and equal height as one setFrames transaction", async () => {
    const image = await png(80, 40, { r: 10, g: 10, b: 10 });
    const { app, projectId } = await openProject();
    const asset = await upload(app, projectId, "wide.png", image, "wide");
    const added = await commit(app, projectId, "add", 0, [
      panel(A, asset.id, { x: 10, y: 20, width: 40, height: 20 }),
      panel(B, asset.id, { x: 60, y: 20, width: 40, height: 20 }),
      panel(C, asset.id, { x: 120, y: 20, width: 20, height: 10 }),
    ]);
    const aligned = await commit(app, projectId, "align", added.revision, [
      alignSelection(added.document, [A, B, C], "left", { kind: "selection" }),
    ]);
    expect(aligned.revision).toBe(added.revision + 1);
    expect(aligned.document.panels[B]?.frameMm).toMatchObject({ x: 10, width: 40, height: 20 });
    expect(aligned.document.panels[C]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const distributed = await commit(app, projectId, "distribute", aligned.revision, [
      distributeSelection(added.document, [A, B, C], "horizontal"),
    ]);
    expect(distributed.document.panels[B]?.frameMm.x).toBe(65);
    expect(distributed.document.panelOrder).toEqual([A, B, C]);
    const sized = await commit(app, projectId, "equal-height", distributed.revision, [
      equalSizeSelection(added.document, [C, A], "height"),
    ]);
    expect(sized.document.panels[C]?.frameMm).toEqual({ x: 120, y: 20, width: 40, height: 20 });
    const outside = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "outside", "content-type": "application/json" },
      payload: {
        baseRevision: sized.revision,
        commands: [{ type: "panel.setFrames", items: [{ panelId: A, frameMm: { x: 10, y: 0, width: 40, height: 20 } }] }],
      },
    });
    expect(outside.statusCode).toBe(422);
    expect(outside.json().error.code).toBe("OUTSIDE_CANVAS");
    expect(outside.json().error.details.panelIds).toEqual([A]);
    await app.close();
  });

  it("rejects locked elements and partial group edits with catalog codes", async () => {
    const image = await png(80, 40, { r: 1, g: 2, b: 3 });
    const { app, projectId } = await openProject();
    const asset = await upload(app, projectId, "wide.png", image, "wide");
    const added = await commit(app, projectId, "add", 0, [
      panel(A, asset.id, { x: 10, y: 20, width: 40, height: 20 }),
      panel(B, asset.id, { x: 70, y: 20, width: 40, height: 20 }),
    ]);
    const locked = await commit(app, projectId, "lock", added.revision, [
      { type: "panel.setLocked", panelIds: [A], locked: true },
    ]);
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "move-locked", "content-type": "application/json" },
      payload: {
        baseRevision: locked.revision,
        commands: [translateSelection(locked.document, [A], 3, 0)],
      },
    });
    expect(denied.statusCode).toBe(422);
    expect(denied.json().error.code).toBe("LOCKED_ELEMENT");
    expect(denied.json().error.details.panelIds).toEqual([A]);
    const unlocked = await commit(app, projectId, "unlock", locked.revision, [
      { type: "panel.setLocked", panelIds: [A], locked: false },
    ]);
    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "move-locked", "content-type": "application/json" },
      payload: {
        baseRevision: locked.revision,
        commands: [translateSelection(locked.document, [A], 3, 0)],
      },
    });
    expect(retried.statusCode).toBe(409);
    expect(retried.json().error.code).toBe("REVISION_CONFLICT");
    const moved = await commit(app, projectId, "move-after-unlock", unlocked.revision, [
      translateSelection(unlocked.document, [A], 3, 0),
    ]);
    expect(moved.document.panels[A]?.frameMm.x).toBe(13);

    const grouped = await commit(app, projectId, "group", moved.revision, [
      { type: "group.create", groupId: GROUP, name: "Pair", panelIds: [A, B] },
    ]);
    const partial = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "partial", "content-type": "application/json" },
      payload: {
        baseRevision: grouped.revision,
        commands: [{ type: "panel.setFrames", items: [{ panelId: B, frameMm: { x: 80, y: 20, width: 40, height: 20 } }] }],
      },
    });
    expect(partial.statusCode).toBe(422);
    expect(partial.json().error.code).toBe("GROUP_PARTIAL_EDIT");
    const together = await commit(app, projectId, "group-move", grouped.revision, [
      translateSelection(grouped.document, [B], 4, 0),
    ]);
    expect(together.document.panels[A]?.frameMm.x).toBe(17);
    expect(together.document.panels[B]?.frameMm.x).toBe(74);
    expect(together.document.panels[A]?.frameMm.width).toBe(40);
    const stillThere = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
    expect(stillThere.json().revision).toBe(together.revision);
    await app.close();
  });

  it("replaces an asset, edits labels, and undoes a canvas reflow as one revision", async () => {
    const wide = await png(80, 40, { r: 9, g: 9, b: 9 });
    const square = await png(40, 40, { r: 4, g: 90, b: 4 });
    const { app, projectId } = await openProject();
    const wideAsset = await upload(app, projectId, "wide.png", wide, "wide");
    const squareAsset = await upload(app, projectId, "square.png", square, "square");
    const added = await commit(app, projectId, "add", 0, [
      panel(A, wideAsset.id, { x: 10, y: 20, width: 40, height: 20 }),
      panel(B, wideAsset.id, { x: 70, y: 20, width: 40, height: 20 }),
    ]);
    const replaced = await commit(app, projectId, "replace", added.revision, [
      { type: "panel.replaceAsset", panelId: A, assetId: squareAsset.id },
    ]);
    expect(replaced.document.panels[A]?.frameMm).toEqual({ x: 20, y: 20, width: 20, height: 20 });
    expect(replaced.document.panels[A]?.cropNormalized).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(replaced.document.panels[A]?.name).toBe("wide.png");
    const styled = await commit(app, projectId, "labels", replaced.revision, [
      {
        type: "label.setStyle",
        labelStyle: { ...replaced.document.labelStyle, format: "dot" },
      },
      {
        type: "label.setOverrides",
        items: [
          {
            panelId: B,
            value: { visible: null, text: "Note", placement: null, offsetMm: null, typography: null },
          },
        ],
      },
      { type: "panel.reorderLabels", panelOrder: [B, A], resetTextOverrides: false },
      { type: "panel.setStackOrder", stackOrder: [B, A] },
      { type: "panel.rename", panelId: A, name: "Replacement" },
    ]);
    expect(styled.document.panels[B]?.labelOverrides.text).toBe("Note");
    expect(styled.document.panelOrder).toEqual([B, A]);
    expect(styled.document.stackOrder).toEqual([B, A]);
    expect(styled.document.panels[A]?.name).toBe("Replacement");
    expect(styled.revision).toBe(replaced.revision + 1);
    const undone = await history(app, projectId, "undo", "undo-labels", styled.revision);
    expect((undone.json() as TransactionBody).document.panels[A]?.name).toBe("wide.png");
    expect((undone.json() as TransactionBody).document.panelOrder).toEqual([A, B]);

    const current = undone.json() as TransactionBody;
    const frameA = current.document.panels[A]?.frameMm;
    const frameB = current.document.panels[B]?.frameMm;
    if (!frameA || !frameB) throw new Error("missing frames");
    const canvas = { ...current.document.canvas, heightMm: 36 };
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "shrink", "content-type": "application/json" },
      payload: { baseRevision: current.revision, commands: [{ type: "canvas.set", canvas }] },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("OUTSIDE_CANVAS");
    const refit = await commit(app, projectId, "refit", current.revision, [
      { type: "canvas.set", canvas },
      {
        type: "panel.setFrames",
        items: [
          { panelId: A, frameMm: { ...frameA, y: 12 } },
          { panelId: B, frameMm: { ...frameB, y: 12 } },
        ],
      },
      {
        type: "layout.setSettings",
        layoutSettings: {
          ...current.document.layoutSettings,
          gutterMm: { horizontal: 3, vertical: 3 },
        },
      },
    ]);
    expect(refit.document.canvas.heightMm).toBe(36);
    expect(refit.document.layoutSettings.gutterMm.horizontal).toBe(3);
    expect(refit.document.panels[B]?.frameMm.y).toBe(12);
    const restored = await history(app, projectId, "undo", "undo-refit", refit.revision);
    const restoredBody = restored.json() as TransactionBody;
    expect(restoredBody.document.canvas.heightMm).toBe(120);
    expect(restoredBody.document.panels[B]?.frameMm.y).toBe(20);
    expect(restoredBody.document.layoutSettings.gutterMm.horizontal).toBe(4);
    expect(await original(app, projectId, wideAsset.id)).toEqual(wide);
    expect(await original(app, projectId, squareAsset.id)).toEqual(square);
    await app.close();
  });

  async function openProject(): Promise<{ app: App; projectId: string; dataDir: string }> {
    const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-phase2-"));
    directories.push(dataDir);
    const app = createServer({ dataDir });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "project", "content-type": "application/json" },
      payload: { title: "Phase 2" },
    });
    expect(created.statusCode).toBe(201);
    return { app, projectId: created.json().project.id as string, dataDir };
  }
});

function panel(panelId: string, assetId: string, frameMm: { x: number; y: number; width: number; height: number }) {
  return { type: "panel.add" as const, panelId, assetId, frameMm };
}

async function png(width: number, height: number, background: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

async function commit(
  app: App,
  projectId: string,
  key: string,
  baseRevision: number,
  commands: unknown[],
): Promise<TransactionBody> {
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

async function history(app: App, projectId: string, direction: "undo" | "redo", key: string, baseRevision: number) {
  return app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/history/${direction}`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload: { baseRevision },
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

async function original(app: App, projectId: string, assetId: string): Promise<Buffer> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/assets/${assetId}/original`,
  });
  expect(response.statusCode).toBe(200);
  return response.rawPayload;
}

function readHistory(dataDir: string): {
  currentRevision: number;
  rows: Array<{ revision: number; kind: string; targetRevision: number | null; commandsJson: string; documentHash: string }>;
} {
  const db = new Database(path.join(dataDir, "panelstudio.sqlite"), { readonly: true });
  const project = db.prepare(`SELECT currentRevision FROM projects`).get() as { currentRevision: number };
  const rows = db
    .prepare(
      `SELECT revision, kind, targetRevision, commandsJson, documentHash FROM project_revisions ORDER BY revision`,
    )
    .all() as Array<{
    revision: number;
    kind: string;
    targetRevision: number | null;
    commandsJson: string;
    documentHash: string;
  }>;
  db.close();
  return { currentRevision: project.currentRevision, rows };
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
