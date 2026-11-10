import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JobSchema,
  ProjectPageSchema,
  ProjectSchema,
  RevisionPageSchema,
  RevisionSnapshotSchema,
  type FigureDocumentV1,
  type Job,
  type Project,
} from "@panelstudio/contracts";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, drainServerAiJobs } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type App = ReturnType<typeof createServer>;

type ProjectPage = { items: Project[]; nextCursor: string | null };
type RevisionPage = {
  items: Array<{ revision: number; documentHash: string; kind: string }>;
  nextCursor: string | null;
};

describe("project list, soft-delete, restore, and revisions", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("pages projects and assets and rejects a bad query", async () => {
    const { app } = open(directories);
    const first = await create(app, "First");
    const second = await create(app, "Second");
    const third = await create(app, "Third");
    const walked = await walk(app, "/api/v1/projects", 1);
    const all = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(all.statusCode).toBe(200);
    const page = all.json() as ProjectPage;
    expect(Check(ProjectPageSchema, page)).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.id)).toEqual(walked);
    expect(new Set(walked)).toEqual(new Set([first, second, third]));
    expect(page.items.every((item) => item.deletedAt === null)).toBe(true);

    await app.inject({ method: "DELETE", url: `/api/v1/projects/${second}` });
    const visible = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect((visible.json() as ProjectPage).items.map((item) => item.id)).toEqual(walked.filter((id) => id !== second));
    const withDeleted = await app.inject({ method: "GET", url: "/api/v1/projects?includeDeleted=true" });
    expect((withDeleted.json() as ProjectPage).items.map((item) => item.id).sort()).toEqual([first, second, third].sort());

    const png = readFileSync(path.join(root, "fixtures/mixed/raster.png"));
    const assets = [
      await upload(app, first, png, "one.png", "asset-1"),
      await upload(app, first, png, "two.png", "asset-2"),
      await upload(app, first, png, "three.png", "asset-3"),
    ];
    const assetIds = await walk(app, `/api/v1/projects/${first}/assets`, 2);
    const assetPage = await app.inject({ method: "GET", url: `/api/v1/projects/${first}/assets` });
    expect(assetPage.json()).toMatchObject({ nextCursor: null });
    expect((assetPage.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(assetIds);
    expect(new Set(assetIds)).toEqual(new Set(assets));

    expect((await app.inject({ method: "GET", url: "/api/v1/projects?limit=0" })).json().error.code).toBe("REQUEST_INVALID");
    expect((await app.inject({ method: "GET", url: "/api/v1/projects?limit=101" })).json().error.code).toBe("REQUEST_INVALID");
    expect((await app.inject({ method: "GET", url: "/api/v1/projects?cursor=" })).json().error.code).toBe("REQUEST_INVALID");
    expect((await app.inject({ method: "GET", url: "/api/v1/projects?includeDeleted=yes" })).json().error.code).toBe("REQUEST_INVALID");
    expect((await app.inject({ method: "GET", url: "/api/v1/projects?cursor=not-a-cursor" })).json().error.code).toBe("REQUEST_INVALID");
    await app.close();
  });

  it("soft-deletes without removing bytes, cancels an open job, and restores history", async () => {
    const { app } = open(directories, true);
    const projectId = await create(app, "Kept");
    const png = readFileSync(path.join(root, "fixtures/mixed/raster.png"));
    const assetId = await upload(app, projectId, png, "raster.png", "bytes");
    const before = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
    const document = before.json().document as FigureDocumentV1;
    const changed = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "widen", "content-type": "application/json" },
      payload: {
        baseRevision: 0,
        commands: [{ type: "canvas.set", canvas: { ...document.canvas, widthMm: 120 } }],
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().revision).toBe(1);
    const savedHash = changed.json().documentHash as string;

    const queued = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/ai-layouts`,
      headers: { "idempotency-key": "queued-layout", "content-type": "application/json" },
      payload: {
        baseRevision: 1,
        prompt: "把间距改成 3 mm",
        selectedPanelIds: [],
        replyLocale: "zh-CN",
        includePreviewImage: false,
        visualReview: false,
      },
    });
    expect(queued.statusCode).toBe(202);
    const jobId = queued.json().jobId as string;

    const deleted = await app.inject({ method: "DELETE", url: `/api/v1/projects/${projectId}` });
    expect(deleted.statusCode).toBe(200);
    const deletedProject = deleted.json() as Project;
    expect(Check(ProjectSchema, deletedProject)).toBe(true);
    expect(deletedProject.deletedAt).toEqual(expect.any(String));
    expect(deletedProject.currentRevision).toBe(1);
    const again = await app.inject({ method: "DELETE", url: `/api/v1/projects/${projectId}` });
    expect(again.json()).toMatchObject({ deletedAt: deletedProject.deletedAt, updatedAt: deletedProject.updatedAt });

    await drainServerAiJobs(app);
    const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });
    expect(job.statusCode).toBe(200);
    const jobBody = job.json() as Job;
    expect(Check(JobSchema, jobBody)).toBe(true);
    expect(jobBody.status).toBe("cancelled");
    expect(jobBody.error).toBeNull();

    expect(await bytes(app, `/api/v1/projects/${projectId}/assets/${assetId}/original`)).toEqual(png);
    const stillThere = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/document` });
    expect(stillThere.json()).toMatchObject({ revision: 1, documentHash: savedHash, history: { canUndo: true, canRedo: false } });

    for (const call of [
      () => app.inject({ method: "PATCH", url: `/api/v1/projects/${projectId}`, headers: { "content-type": "application/json" }, payload: { title: "Nope" } }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/transactions`,
        headers: { "idempotency-key": "after-delete", "content-type": "application/json" },
        payload: { baseRevision: 1, commands: [{ type: "canvas.set", canvas: document.canvas }] },
      }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/history/undo`,
        headers: { "idempotency-key": "undo-deleted", "content-type": "application/json" },
        payload: { baseRevision: 1 },
      }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/assets`,
        headers: { "idempotency-key": "upload-deleted", ...multipartHeaders(png, "again.png") },
        payload: multipartBody(png, "again.png"),
      }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/layout-candidates`,
        headers: { "idempotency-key": "layout-deleted", "content-type": "application/json" },
        payload: { baseRevision: 1, request: { family: "auto" } },
      }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/ai-layouts`,
        headers: { "idempotency-key": "ai-deleted", "content-type": "application/json" },
        payload: {
          baseRevision: 1,
          prompt: "再排一次",
          selectedPanelIds: [],
          replyLocale: "zh-CN",
          includePreviewImage: false,
          visualReview: false,
        },
      }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/previews`,
        headers: { "idempotency-key": "preview-deleted", "content-type": "application/json" },
        payload: { source: { revision: 1 }, pixelWidth: 64 },
      }),
      () => app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/exports`,
        headers: { "idempotency-key": "export-deleted", "content-type": "application/json" },
        payload: { revision: 1, format: "svg", options: { includeMetadata: false } },
      }),
    ]) {
      const response = await call();
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("PROJECT_DELETED");
    }

    const revisions = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/revisions` });
    expect(revisions.statusCode).toBe(200);
    const revisionPage = revisions.json() as RevisionPage;
    expect(Check(RevisionPageSchema, revisionPage)).toBe(true);
    expect(revisionPage.nextCursor).toBeNull();
    expect(revisionPage.items.map((item) => item.revision)).toEqual([0, 1]);
    expect(revisionPage.items.map((item) => item.kind)).toEqual(["create", "transaction"]);
    const paged = await walk(app, `/api/v1/projects/${projectId}/revisions`, 1);
    expect(paged).toEqual(["0", "1"]);

    const oldest = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/revisions/0` });
    expect(oldest.statusCode).toBe(200);
    expect(Check(RevisionSnapshotSchema, oldest.json())).toBe(true);
    expect(oldest.json().document.canvas.widthMm).toBe(180);
    expect(oldest.json().documentHash).not.toBe(savedHash);
    const latest = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/revisions/1` });
    expect(latest.json().document.canvas.widthMm).toBe(120);
    expect(latest.json().documentHash).toBe(savedHash);
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/revisions/nope` })).json().error.code).toBe("REQUEST_INVALID");
    expect((await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/revisions/9` })).statusCode).toBe(404);

    const missingKey = await app.inject({ method: "POST", url: `/api/v1/projects/${projectId}/restore` });
    expect(missingKey.statusCode).toBe(400);
    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/restore`,
      headers: { "idempotency-key": "restore", "content-type": "application/json" },
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: projectId, deletedAt: null, currentRevision: 1 });
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/restore`,
      headers: { "idempotency-key": "restore", "content-type": "application/json" },
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(restored.json());
    const reused = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/restore`,
      headers: { "idempotency-key": "restore", "content-type": "application/json" },
      payload: { extra: true },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const undone = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/history/undo`,
      headers: { "idempotency-key": "undo-restored", "content-type": "application/json" },
      payload: { baseRevision: 1 },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().revision).toBe(2);
    expect(undone.json().document.canvas.widthMm).toBe(180);
    expect(undone.json().documentHash).toBe(oldest.json().documentHash);

    expect((await app.inject({ method: "DELETE", url: "/api/v1/projects/missing" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/v1/projects/missing/restore", headers: { "idempotency-key": "missing" } })).statusCode).toBe(404);
    const other = await create(app, "Live");
    const live = await app.inject({ method: "GET", url: `/api/v1/projects/${other}` });
    const noop = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${other}/restore`,
      headers: { "idempotency-key": "already-live", "content-type": "application/json" },
      payload: {},
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json()).toMatchObject({ deletedAt: null, updatedAt: live.json().updatedAt, currentRevision: 0 });
    await app.close();
  });
});

function open(directories: string[], deferAiJobs = false): { app: App } {
  const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-projects-"));
  directories.push(dataDir);
  return { app: createServer({ dataDir, deferAiJobs }) };
}

async function create(app: App, title: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { "idempotency-key": title, "content-type": "application/json" },
    payload: { title },
  });
  expect(response.statusCode).toBe(201);
  return response.json().project.id as string;
}

async function walk(app: App, pathName: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const url = new URL(pathName, "http://localhost");
    url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ id?: string; revision?: number }>; nextCursor: string | null };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(limit);
    ids.push(...body.items.map((item) => (item.id ?? String(item.revision))));
    if (!body.nextCursor) return ids;
    expect(body.nextCursor).not.toBe("");
    cursor = body.nextCursor;
  }
  throw new Error("pagination did not end");
}

async function upload(app: App, projectId: string, bytes: Buffer, filename: string, key: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/assets`,
    headers: { "idempotency-key": key, ...multipartHeaders(bytes, filename) },
    payload: multipartBody(bytes, filename),
  });
  expect(response.statusCode).toBe(202);
  const job = await app.inject({ method: "GET", url: `/api/v1/jobs/${response.json().jobId as string}` });
  expect(job.json().status).toBe("succeeded");
  return response.json().assetId as string;
}

async function bytes(app: App, url: string): Promise<Buffer> {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(200);
  return response.rawPayload;
}

function multipartHeaders(bytes: Buffer, filename: string) {
  return {
    "content-type": "multipart/form-data; boundary=----panelstudio",
    "content-length": String(multipartBody(bytes, filename).byteLength),
  };
}

function multipartBody(bytes: Buffer, filename: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `------panelstudio\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n------panelstudio--\r\n"),
  ]);
}
