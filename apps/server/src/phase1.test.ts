import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AssetSchema,
  ExportJobResultSchema,
  JobSchema,
  pngPixelsFromMm,
  type Asset,
  type ExportRequest,
  type Job,
} from "@panelstudio/contracts";
import { parseSvgDocument } from "@panelstudio/svg";
import { Check } from "typebox/value";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PNG_ID = "11111111-1111-4111-8111-111111111111";
const SVG_A = "11111111-1111-4111-8111-111111111112";
const SVG_B = "11111111-1111-4111-8111-111111111113";
const JPEG_ID = "11111111-1111-4111-8111-111111111114";

describe("phase 1 import to editable SVG", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("round-trips a mixed figure without id collisions or rasterized vectors", async () => {
    const png = readFileSync(path.join(root, "fixtures/mixed/raster.png"));
    const jpeg = readFileSync(path.join(root, "fixtures/mixed/photo.jpg"));
    const svg = readFileSync(path.join(root, "fixtures/mixed/panel-vector.svg"));
    const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-phase1-"));
    directories.push(dataDir);
    const app = createServer({ dataDir });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "project-mixed", "content-type": "application/json" },
      payload: { title: "Mixed figure" },
    });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().project.id as string;

    const repeated = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "project-mixed", "content-type": "application/json" },
      payload: { title: "Mixed figure" },
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json().project.id).toBe(projectId);
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "project-mixed", "content-type": "application/json" },
      payload: { title: "Different title" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const pngAsset = await upload(app, projectId, "raster.png", png, "image/png", "asset-png");
    const jpegAsset = await upload(app, projectId, "photo.jpg", jpeg, "image/jpeg", "asset-jpeg");
    const svgAsset = await upload(app, projectId, "panel-vector.svg", svg, "image/svg+xml", "asset-svg");
    expect(pngAsset.normalized?.renderMediaType).toBe("image/png");
    expect(jpegAsset.normalized?.renderMediaType).toBe("image/png");
    expect(svgAsset.normalized?.renderMediaType).toBe("image/svg+xml");
    expect(svgAsset.normalized?.viewport).toEqual({ width: 100, height: 50 });
    const storedSvg = await download(app, `/api/v1/projects/${projectId}/assets/${svgAsset.id}/content`);
    expect(storedSvg.includes("<path")).toBe(true);
    expect(storedSvg.includes("<image")).toBe(false);
    expect(await download(app, `/api/v1/projects/${projectId}/assets/${pngAsset.id}/original`)).toEqual(png);
    expect(await download(app, `/api/v1/projects/${projectId}/assets/${jpegAsset.id}/original`)).toEqual(jpeg);

    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "add-panels", "content-type": "application/json" },
      payload: {
        baseRevision: 0,
        commands: [
          panel(PNG_ID, pngAsset.id, { x: 10, y: 12, width: 40, height: 20 }),
          panel(SVG_A, svgAsset.id, { x: 60, y: 12, width: 40, height: 20 }),
          panel(SVG_B, svgAsset.id, { x: 110, y: 12, width: 40, height: 20 }),
          panel(JPEG_ID, jpegAsset.id, { x: 10, y: 48, width: 30, height: 20 }),
        ],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().revision).toBe(1);
    expect(saved.json().changed).toBe(true);
    expect(saved.json().history.canUndo).toBe(true);
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "add-panels", "content-type": "application/json" },
      payload: {
        baseRevision: 0,
        commands: [
          panel(PNG_ID, pngAsset.id, { x: 10, y: 12, width: 40, height: 20 }),
          panel(SVG_A, svgAsset.id, { x: 60, y: 12, width: 40, height: 20 }),
          panel(SVG_B, svgAsset.id, { x: 110, y: 12, width: 40, height: 20 }),
          panel(JPEG_ID, jpegAsset.id, { x: 10, y: 48, width: 30, height: 20 }),
        ],
      },
    });
    expect(replay.json().revision).toBe(1);
    const stale = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/transactions`,
      headers: { "idempotency-key": "stale", "content-type": "application/json" },
      payload: {
        baseRevision: 0,
        commands: [panel("11111111-1111-4111-8111-111111111115", pngAsset.id, { x: 50, y: 48, width: 40, height: 20 })],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("REVISION_CONFLICT");

    const exported = await exportOf(app, projectId, {
      revision: 1,
      format: "svg",
      options: { includeMetadata: false },
    });
    const figure = await download(app, `/api/v1/artifacts/${exported.artifactId}/download`);
    if (process.env.WRITE_SAMPLE === "1") {
      writeFileSync(path.join(root, "fixtures/expected/mixed-panels.svg"), figure);
    }
    expect(figure.includes('width="180mm"')).toBe(true);
    expect(figure.includes('height="120mm"')).toBe(true);
    expect(figure.includes('font-size="3.175"')).toBe(true);
    expect(figure.includes(">A</text>")).toBe(true);
    expect(figure.includes(">B</text>")).toBe(true);
    expect(figure.includes(">C</text>")).toBe(true);
    expect(figure.includes(">D</text>")).toBe(true);
    expect(figure.includes('font-family="Noto Sans"')).toBe(true);
    const document = parseSvgDocument(figure.toString("utf8"));
    const ids = collectIds(document);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.endsWith("--fade"))).toHaveLength(2);
    expect(figure.includes('id="fade"')).toBe(false);
    expect(document.getElementsByTagName("image").length).toBe(2);
    for (const panelId of [SVG_A, SVG_B]) {
      const content = document.getElementById(`panel-${panelId}-content`);
      expect(content?.getAttribute("clip-path")).toBe(`url(#panel-${panelId}-crop)`);
      expect(content?.getElementsByTagName("image").length).toBe(0);
      expect(content?.getElementsByTagName("path").length).toBeGreaterThan(0);
      expect(content?.getElementsByTagName("text").length).toBe(1);
      const label = document.getElementById(`panel-${panelId}-label`);
      expect(label?.parentElement?.getAttribute("id") ?? label?.parentNode?.nodeName).toBeTruthy();
      expect(label?.parentNode).toBe(document.getElementById(`panel-${panelId}`));
    }
    expect(figure.toString("utf8").match(/d="M10 30 C 20 10, 40 10, 60 30"/gu)).toHaveLength(2);
    const pngJob = await exportOf(app, projectId, { revision: 1, format: "png", options: { dpi: 150 } });
    const pngOut = await download(app, `/api/v1/artifacts/${pngJob.artifactId}/download`);
    expect(pngOut.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect((await sharp(pngOut).metadata()).width).toBe(pngPixelsFromMm(180, 150));

    const packaged = await exportOf(app, projectId, {
      revision: 1,
      format: "project",
      options: { includeBundledFonts: false },
    });
    const zip = await download(app, `/api/v1/artifacts/${packaged.artifactId}/download`);
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/project-imports",
      headers: { "idempotency-key": "import-mixed", ...multipartHeaders(zip, "Mixed-figure.figurezip") },
      payload: multipartBody(zip, "Mixed-figure.figurezip"),
    });
    expect(imported.statusCode).toBe(202);
    const importJob = await jobOf(app, imported.json().jobId as string);
    expect(importJob.status).toBe("succeeded");
    expect(importJob.result && "projectId" in importJob.result ? importJob.result.projectId : "").not.toBe(projectId);
    const restoredId =
      importJob.result && "projectId" in importJob.result ? importJob.result.projectId : "";
    const restoredAssets = await app.inject({ method: "GET", url: `/api/v1/projects/${restoredId}/assets` });
    const items = restoredAssets.json().items as Asset[];
    const byName = new Map(items.map((item) => [item.originalFilename, item]));
    expect(await download(app, `/api/v1/projects/${restoredId}/assets/${byName.get("raster.png")?.id}/original`)).toEqual(png);
    expect(await download(app, `/api/v1/projects/${restoredId}/assets/${byName.get("photo.jpg")?.id}/original`)).toEqual(jpeg);
    expect(await download(app, `/api/v1/projects/${restoredId}/assets/${byName.get("panel-vector.svg")?.id}/original`)).toEqual(svg);

    await app.close();
  });

  it("rejects an SVG script and keeps the original bytes", async () => {
    const script = readFileSync(path.join(root, "fixtures/rejected/script.svg"));
    const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-reject-"));
    directories.push(dataDir);
    const app = createServer({ dataDir });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "reject-project", "content-type": "application/json" },
      payload: { title: "Rejected" },
    });
    const projectId = created.json().project.id as string;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/assets`,
      headers: { "idempotency-key": "script", ...multipartHeaders(script, "script.svg", "image/svg+xml") },
      payload: multipartBody(script, "script.svg", "image/svg+xml"),
    });
    expect(response.statusCode).toBe(202);
    const job = await jobOf(app, response.json().jobId as string);
    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SVG_UNSUPPORTED_FEATURE");
    const assetId = response.json().assetId as string;
    expect(await download(app, `/api/v1/projects/${projectId}/assets/${assetId}/original`)).toEqual(script);
    await app.close();
  });

  it("orients JPEG pixels and preserves the original bytes", async () => {
    const jpeg = await sharp({
      create: { width: 30, height: 16, channels: 3, background: { r: 10, g: 180, b: 80 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-exif-"));
    directories.push(dataDir);
    const app = createServer({ dataDir });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "exif-project", "content-type": "application/json" },
      payload: { title: "Exif" },
    });
    const projectId = created.json().project.id as string;
    const asset = await upload(app, projectId, "exif.jpg", jpeg, "image/jpeg", "exif");
    expect(asset.normalized?.rasterPixelSize).toEqual({ width: 16, height: 30 });
    expect(asset.normalized?.normalizationNotes.join(" ")).toContain("exifOrientation:6");
    expect(await download(app, `/api/v1/projects/${projectId}/assets/${asset.id}/original`)).toEqual(jpeg);
    await app.close();
  });

  it("keeps WebP originals and embeds a PNG derivative", async () => {
    const webp = await sharp({
      create: { width: 12, height: 8, channels: 3, background: { r: 20, g: 40, b: 200 } },
    })
      .webp()
      .toBuffer();
    const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-webp-"));
    directories.push(dataDir);
    const app = createServer({ dataDir });
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { "idempotency-key": "webp-project", "content-type": "application/json" },
      payload: { title: "WebP" },
    });
    const projectId = created.json().project.id as string;
    const asset = await upload(app, projectId, "panel.webp", webp, "image/webp", "webp");
    expect(asset.originalMediaType).toBe("image/webp");
    expect(asset.normalized?.renderMediaType).toBe("image/png");
    expect(await download(app, `/api/v1/projects/${projectId}/assets/${asset.id}/original`)).toEqual(webp);
    await app.close();
  });
});

function panel(panelId: string, assetId: string, frameMm: { x: number; y: number; width: number; height: number }) {
  return { type: "panel.add" as const, panelId, assetId, frameMm };
}

async function upload(
  app: ReturnType<typeof createServer>,
  projectId: string,
  filename: string,
  bytes: Buffer,
  mediaType: string,
  key: string,
): Promise<Asset> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/assets`,
    headers: { "idempotency-key": key, ...multipartHeaders(bytes, filename, mediaType) },
    payload: multipartBody(bytes, filename, mediaType),
  });
  expect(response.statusCode).toBe(202);
  const job = await jobOf(app, response.json().jobId as string);
  expect(job.status).toBe("succeeded");
  const asset = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}/assets/${response.json().assetId as string}`,
  });
  expect(asset.statusCode).toBe(200);
  const body = asset.json() as Asset;
  expect(Check(AssetSchema, body)).toBe(true);
  return body;
}

async function exportOf(
  app: ReturnType<typeof createServer>,
  projectId: string,
  payload: ExportRequest,
): Promise<{ artifactId: string }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/exports`,
    headers: { "idempotency-key": `export-${payload.format}-${payload.revision}`, "content-type": "application/json" },
    payload,
  });
  expect(response.statusCode).toBe(202);
  const job = await jobOf(app, response.json().jobId as string);
  expect(job.status).toBe("succeeded");
  expect(job.result && Check(ExportJobResultSchema, job.result)).toBe(true);
  return job.result as { artifactId: string };
}

async function jobOf(app: ReturnType<typeof createServer>, jobId: string): Promise<Job> {
  const response = await app.inject({ method: "GET", url: `/api/v1/jobs/${jobId}` });
  expect(response.statusCode).toBe(200);
  const body = response.json() as Job;
  expect(Check(JobSchema, body)).toBe(true);
  return body;
}

async function download(app: ReturnType<typeof createServer>, url: string): Promise<Buffer> {
  const response = await app.inject({ method: "GET", url });
  expect(response.statusCode).toBe(200);
  return response.rawPayload;
}

function multipartHeaders(bytes: Buffer, filename: string, mediaType = "application/octet-stream") {
  return {
    "content-type": "multipart/form-data; boundary=----panelstudio",
    "content-length": String(multipartBody(bytes, filename, mediaType).byteLength),
  };
}

function multipartBody(bytes: Buffer, filename: string, mediaType = "application/octet-stream"): Buffer {
  return Buffer.concat([
    Buffer.from(
      `------panelstudio\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mediaType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n------panelstudio--\r\n"),
  ]);
}

function collectIds(document: Document): string[] {
  const ids: string[] = [];
  const elements = document.getElementsByTagName("*");
  for (let index = 0; index < elements.length; index += 1) {
    const id = elements.item(index)?.getAttribute("id");
    if (id) ids.push(id);
  }
  return ids;
}
