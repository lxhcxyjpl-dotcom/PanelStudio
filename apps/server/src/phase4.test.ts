import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PANEL = "11111111-1111-4111-8111-111111111111";

describe("phase 4 project chrome routes", () => {
  const directories: string[] = [];

  afterEach(async () => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("renames a project without entering canvas history", async () => {
    const { app, projectId } = await open(directories);
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { "content-type": "application/json" },
      payload: { title: "Figure B" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().title).toBe("Figure B");
    expect(renamed.json().currentRevision).toBe(0);
    const document = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
    expect(document.json().revision).toBe(0);
    expect(document.json().history).toEqual({ canUndo: false, canRedo: false });
    const empty = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${projectId}`,
      headers: { "content-type": "application/json" },
      payload: { title: "" },
    });
    expect(empty.statusCode).toBe(400);
    await app.close();
  });

  it("removes an unused asset and refuses one the document uses", async () => {
    const { app, projectId } = await open(directories);
    const png = readFileSync(path.join(root, "fixtures/mixed/raster.png"));
    const assetId = await upload(app, projectId, png);
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "add-panel", "content-type": "application/json" },
      payload: {
        baseRevision: 0,
        commands: [
          {
            type: "panel.add",
            panelId: PANEL,
            assetId,
            frameMm: { x: 8, y: 8, width: 40, height: 20 },
          },
        ],
      },
    });
    expect(added.statusCode).toBe(200);
    const used = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}/assets/${assetId}`,
    });
    expect(used.statusCode).toBe(409);
    expect(used.json().error.code).toBe("ASSET_IN_USE");
    const removed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "remove-panel", "content-type": "application/json" },
      payload: { baseRevision: 1, commands: [{ type: "panel.remove", panelIds: [PANEL] }] },
    });
    expect(removed.statusCode).toBe(200);
    const gone = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${projectId}/assets/${assetId}`,
    });
    expect(gone.statusCode).toBe(200);
    expect(gone.json().removedFromLibraryAt).toEqual(expect.any(String));
    await app.close();
  });
});

async function open(directories: string[]) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-phase4-"));
  directories.push(dataDir);
  const app = createServer({ dataDir });
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { "idempotency-key": "create", "content-type": "application/json" },
    payload: { title: "Figure A" },
  });
  expect(created.statusCode).toBe(201);
  return { app, projectId: created.json().project.id as string };
}

async function upload(app: ReturnType<typeof createServer>, projectId: string, bytes: Buffer) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/assets`,
    headers: { "idempotency-key": "upload", ...multipartHeaders(bytes) },
    payload: multipartBody(bytes),
  });
  expect(response.statusCode).toBe(202);
  return response.json().assetId as string;
}

function multipartHeaders(bytes: Buffer) {
  return {
    "content-type": "multipart/form-data; boundary=----panelstudio",
    "content-length": String(multipartBody(bytes).byteLength),
  };
}

function multipartBody(bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `------panelstudio\r\nContent-Disposition: form-data; name="file"; filename="raster.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n------panelstudio--\r\n"),
  ]);
}
