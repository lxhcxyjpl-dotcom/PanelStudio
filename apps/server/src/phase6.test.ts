import { waitForTerminalJob } from "./test-jobs.js";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { describe, expect, it, afterEach } from "vitest";
import type { Asset, Diagnostic, ExportRequest, FigureDocumentV1, Job } from "@panelstudio/contracts";
import { hashFigureDocument } from "@panelstudio/core";
import { readProjectPackage } from "./figure-package.js";
import { createServer } from "./index.js";
import { rasterizeSvg } from "./raster.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const exampleDir = path.join(root, "examples/synthetic-six");
const PANEL = "11111111-1111-4111-8111-111111111191";

describe("phase 6 fonts and example", () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("serves the font list and bundle", async () => {
    const app = server();
    const fonts = await app.inject({ method: "GET", url: "/api/v1/fonts" });
    expect(fonts.statusCode).toBe(200);
    expect(fonts.json().fonts.map((font: { family: string }) => font.family)).toEqual(["Noto Sans", "Noto Sans SC"]);
    const bundle = await app.inject({ method: "GET", url: "/api/v1/fonts/bundle" });
    expect(bundle.statusCode).toBe(200);
    expect(bundle.headers["content-type"]).toContain("application/zip");
    expect(Buffer.from(unzipSync(bundle.rawPayload)["OFL-NotoSans.txt"] ?? []).toString("utf8")).toContain("SIL OPEN FONT LICENSE");
    await app.close();
  });

  it("keeps label text and only warns for families or glyphs that are not bundled", async () => {
    const app = server();
    const projectId = await createProject(app, "Glyphs");
    const svg = Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#EEEEEE"/><text font-family="Helvetica" font-size="12">Hi</text></svg>`,
    );
    const asset = await upload(app, projectId, "foreign.svg", svg, "image/svg+xml", "foreign");
    expect(asset.diagnostics.map((item) => item.messageKey)).toContain("font.notInstalled");
    await transact(app, projectId, 0, "place", [
      { type: "panel.add", panelId: PANEL, assetId: asset.id, frameMm: { x: 20, y: 20, width: 40, height: 20 } },
    ]);
    const missing = await exportJob(app, projectId, { revision: 1, format: "svg", options: { includeMetadata: false } }, "svg-missing");
    expect(missing.diagnostics.some((item) => item.messageKey === "font.missingGlyph")).toBe(false);
    const figure = (await download(app, `/api/v1/artifacts/${missing.artifactId}/download`)).toString("utf8");
    expect(figure).toContain('font-family="Noto Sans"');
    expect(figure).toContain('font-family="Helvetica"');
    expect(figure).toContain(">A</text>");
    expect(figure).not.toContain("@font-face");
    const override = { type: "label.setOverrides", items: [{ panelId: PANEL,
      value: { visible: null, text: "中", placement: null, offsetMm: null, typography: null } }] };
    const unavailable = await app.inject({ method: "POST", url: "/api/v1/projects/" + projectId + "/transactions",
      headers: { "idempotency-key": "missing-glyph" }, payload: { baseRevision: 1, commands: [override] } });
    expect(unavailable.json().error.code).toBe("TEXT_METRICS_UNAVAILABLE");
    await transact(app, projectId, 1, "sc", [
      {
        type: "label.setStyle",
        labelStyle: {
          fontId: "noto-sans-sc",
          fontSizePt: 9,
          fontWeight: 700,
          color: "#000000",
          visible: true,
          sequence: "upper-alpha",
          format: "plain",
          placement: "outside-top-left",
          gapMm: 1,
        },
      },
    ]);
    await transact(app, projectId, 2, "han", [override]);
    const sc = await exportJob(app, projectId, { revision: 3, format: "svg", options: { includeMetadata: false } }, "svg-sc");
    expect(sc.diagnostics.some((item) => item.messageKey === "font.missingGlyph")).toBe(false);
    const scSvg = (await download(app, `/api/v1/artifacts/${sc.artifactId}/download`)).toString("utf8");
    expect(scSvg).toContain('font-family="Noto Sans SC"');
    expect(scSvg).toContain(">中</text>");
    await app.close();
  });

  it("puts font files in the package only when includeBundledFonts is true", async () => {
    const app = server();
    const projectId = await createProject(app, "Bundle");
    const png = await sharpPng();
    const asset = await upload(app, projectId, "dot.png", png, "image/png", "dot");
    await transact(app, projectId, 0, "place", [
      { type: "panel.add", panelId: PANEL, assetId: asset.id, frameMm: { x: 12, y: 12, width: 30, height: 20 } },
    ]);
    const withFonts = await packaged(app, projectId, 1, true, "with-fonts");
    const names = Object.keys(unzipSync(withFonts));
    expect(names).toContain("fonts/bundled/NotoSans-Regular.ttf");
    expect(names).toContain("fonts/licenses/OFL-NotoSansSC.txt");
    expect(Buffer.from(unzipSync(withFonts)["fonts/licenses/OFL-NotoSans.txt"] ?? []).toString("utf8")).toContain("SIL OPEN FONT LICENSE");
    const without = await packaged(app, projectId, 1, false, "without-fonts");
    expect(Object.keys(unzipSync(without)).some((name) => name.endsWith(".ttf"))).toBe(false);
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/project-imports",
      headers: { "idempotency-key": "reopen-fonts", ...multipartHeaders(withFonts, "Bundle.figurezip") },
      payload: multipartBody(withFonts, "Bundle.figurezip"),
    });
    expect(imported.statusCode).toBe(202);
    const job = await jobOf(app, imported.json().jobId as string);
    expect(job.status).toBe("succeeded");
    await app.close();
  });

  it("keeps the v0.1 six-panel document hash and project-local UUIDs across repeated imports and export", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ps-package-id-"));
    const app = server(dataDir);
    try {
      const source = readFileSync(path.join(exampleDir, "synthetic-six.figurezip"));
      const original = readProjectPackage(source);
      expect(original.manifest.appVersion).toBe("0.1.0");
      const hash = hashFigureDocument(original.document);
      const ids = original.assets.map((a) => a.id).sort();
      expect(ids).toHaveLength(6);
      const importCopy = async (key: string) => {
        const accepted = await app.inject({ method: "POST", url: "/api/v1/project-imports",
          headers: { "idempotency-key": key, ...multipartHeaders(source, "original.figurezip") },
          payload: multipartBody(source, "original.figurezip") });
        expect(accepted.statusCode).toBe(202);
        const job = await jobOf(app, accepted.json().jobId);
        if (job.kind !== "project_import" || job.status !== "succeeded") throw new Error(JSON.stringify(job.error));
        return job.result.projectId;
      };
      const first = await importCopy("first-copy");
      const listedBlobs = () => readdirSync(path.join(dataDir, "blobs"), { recursive: true }).sort();
      const firstBlobs = listedBlobs();
      expect(firstBlobs.length).toBeGreaterThan(6);
      const second = await importCopy("second-copy");
      expect(first).not.toBe(second);
      expect(listedBlobs()).toEqual(firstBlobs);
      expect(await importCopy("second-copy")).toBe(second);
      const read = async (project: string) => (await app.inject({ method: "GET", url: `/api/v1/projects/${project}/document` })).json() as { document: FigureDocumentV1; documentHash: string; revision: number };
      for (const project of [first, second]) {
        const state = await read(project);
        expect(state).toMatchObject({ document: original.document, revision: 0, documentHash: hash });
        expect(state.document).toEqual(original.document);
        const library = (await app.inject({ method: "GET", url: `/api/v1/projects/${project}/assets` })).json().items as Asset[];
        expect(library.map((asset) => asset.id).sort()).toEqual(ids);
        expect(library.every((asset) => asset.projectId === project)).toBe(true);
      }
      const restored = readProjectPackage(await packaged(app, first, 0, false, "re-export-v01"));
      expect(restored.document).toEqual(original.document);
      expect(hashFigureDocument(restored.document)).toBe(hash);
      const assetFiles = (files: typeof original.manifest.files) => files.filter((file) => file.path.startsWith("assets/"));
      expect(assetFiles(restored.manifest.files)).toEqual(assetFiles(original.manifest.files));
      const panel = original.document.panelOrder[0]!, assetId = original.document.panels[panel]!.assetId;
      const assetRoute = (project: string) => `/api/v1/projects/${project}/assets/${assetId}`;
      await transact(app, second, 0, "remove-second-only", [{ type: "panel.remove", panelIds: [panel] }]);
      const removed = await app.inject({ method: "DELETE", url: assetRoute(second) });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(removed.json().removedFromLibraryAt).toBeTruthy();
      expect((await app.inject({ method: "GET", url: assetRoute(first) })).json().removedFromLibraryAt).toBeNull();
      expect((await read(first)).documentHash).toBe(hash);
      expect((await read(second)).document.panels[panel]).toBeUndefined();
      expect(await download(app, assetRoute(first) + "/original")).toEqual(original.assets.find((asset) => asset.id === assetId)!.original);
      const unrelated = await createProject(app, "No assets");
      expect((await app.inject({ method: "GET", url: assetRoute(unrelated) })).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it("ships an original six-panel example that reopens", async () => {
    const app = server();
    const projectId = await createProject(app, "Synthetic six");
    const heatmapPng = rasterizeSvg(readFileSync(path.join(exampleDir, "assets/heatmap.svg")).toString("utf8"), 280);
    const files: Array<[string, Buffer, string]> = [
      ["line.svg", readFileSync(path.join(exampleDir, "assets/line.svg")), "image/svg+xml"],
      ["bars.svg", readFileSync(path.join(exampleDir, "assets/bars.svg")), "image/svg+xml"],
      ["scatter.svg", readFileSync(path.join(exampleDir, "assets/scatter.svg")), "image/svg+xml"],
      ["schematic.svg", readFileSync(path.join(exampleDir, "assets/schematic.svg")), "image/svg+xml"],
      ["histogram.svg", readFileSync(path.join(exampleDir, "assets/histogram.svg")), "image/svg+xml"],
      ["heatmap.png", heatmapPng, "image/png"],
    ];
    const placed: Array<{ panelId: string; assetId: string; viewport: { width: number; height: number } }> = [];
    for (const [index, file] of files.entries()) {
      const [name, bytes, mediaType] = file;
      const asset = await upload(app, projectId, name, bytes, mediaType, `example-${name}`);
      const viewport = asset.normalized?.viewport;
      if (!viewport) throw new Error("missing viewport");
      placed.push({
        panelId: `11111111-1111-4111-8111-11111111110${index + 1}`,
        assetId: asset.id,
        viewport,
      });
    }
    const commands = layoutCommands(placed);
    await transact(app, projectId, 0, "example-place", commands);
    const svgJob = await exportJob(app, projectId, { revision: 1, format: "svg", options: { includeMetadata: false } }, "example-svg");
    const svg = await download(app, `/api/v1/artifacts/${svgJob.artifactId}/download`);
    const text = svg.toString("utf8");
    expect(text).toContain('font-family="Noto Sans"');
    expect(text).toContain(">F</text>");
    expect(text).toContain("M48 200 C 120 190, 160 80, 230 110 S 360 60, 440 70");
    expect(text).toContain(">n=24</text>");
    expect(text.match(/<text\b/gu)?.length).toBeGreaterThanOrEqual(7);
    expect(svgJob.diagnostics.some((item) => item.code === "FONT_MISSING")).toBe(false);
    const zipJob = await exportJob(
      app,
      projectId,
      { revision: 1, format: "project", options: { includeBundledFonts: true } },
      "example-zip",
    );
    const zip = await download(app, `/api/v1/artifacts/${zipJob.artifactId}/download`);
    expect(Object.keys(unzipSync(zip))).toContain("fonts/bundled/NotoSansSC-Bold.ttf");
    if (process.env.WRITE_EXAMPLE === "1") {
      mkdirSync(path.join(exampleDir, "assets"), { recursive: true });
      writeFileSync(path.join(exampleDir, "assets/heatmap.png"), heatmapPng);
      writeFileSync(path.join(exampleDir, "synthetic-six.svg"), svg);
      writeFileSync(path.join(exampleDir, "synthetic-six.figurezip"), zip);
    }
    const shipped = readFileSync(path.join(exampleDir, "synthetic-six.figurezip"));
    const reopened = await app.inject({
      method: "POST",
      url: "/api/v1/project-imports",
      headers: { "idempotency-key": "example-import", ...multipartHeaders(shipped, "synthetic-six.figurezip") },
      payload: multipartBody(shipped, "synthetic-six.figurezip"),
    });
    const imported = await jobOf(app, reopened.json().jobId as string);
    expect(imported.status).toBe("succeeded");
    const restoredId = imported.result && "projectId" in imported.result ? imported.result.projectId : "";
    const document = await app.inject({ method: "GET", url: `/api/v1/projects/${restoredId}/document` });
    expect(document.json().document.panelOrder).toHaveLength(6);
    await app.close();
  });

  it("reopens the guided example with its chosen focus, frames and original artwork", async () => {
    const app = server();
    try {
      const bundle = readFileSync(new URL("../../../examples/reference-preferences/guided.figurezip", import.meta.url));
      const source = unzipSync(readFileSync(new URL("../../../examples/refinement-six/start.figurezip", import.meta.url)));
      const unpacked = unzipSync(bundle);
      const assets = Object.keys(source).filter((name) => name.startsWith("assets/")).sort();
      expect(Object.keys(unpacked).filter((name) => name.startsWith("assets/")).sort()).toEqual(assets);
      for (const name of assets) expect(Buffer.compare(Buffer.from(source[name]!), Buffer.from(unpacked[name]!))).toBe(0);
      const accepted = await app.inject({method:"POST",url:"/api/v1/project-imports",
        headers:{"idempotency-key":"guided-reopen", ...multipartHeaders(bundle,"guided.figurezip")},payload:multipartBody(bundle,"guided.figurezip")});
      expect(accepted.statusCode).toBe(202);
      const job = await jobOf(app,accepted.json().jobId);
      expect(job.status).toBe("succeeded");
      const id = job.result && "projectId" in job.result ? job.result.projectId : "";
      const { document } = (await app.inject({method:"GET", url:"/api/v1/projects/"+id+"/document"})).json<{document:FigureDocumentV1}>();
      expect(document).toEqual(JSON.parse(Buffer.from(unpacked["document.json"]!).toString("utf8")));
      expect(document.layoutSettings.primaryPanelId).toBe(document.panelOrder[1]);
      expect(document.layoutSettings.gutterMm).toEqual({horizontal:6,vertical:6});
    } finally { await app.close(); }
  });

  function server(dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-phase6-"))) {
    directories.push(dataDir);
    return createServer({ dataDir });
  }
});

function layoutCommands(
  placed: Array<{ panelId: string; assetId: string; viewport: { width: number; height: number } }>,
) {
  const rows = [placed.slice(0, 3), placed.slice(3)];
  const margin = 8;
  const gutter = 4;
  const canvasWidth = 180;
  const content = canvasWidth - margin * 2;
  let y = 8;
  const commands: Array<Record<string, unknown>> = [];
  let bottom = y;
  for (const row of rows) {
    const natural = row.map((item) => ({
      ...item,
      width: 52,
      height: (52 * item.viewport.height) / item.viewport.width,
    }));
    const used = natural.reduce((sum, item) => sum + item.width, 0) + gutter * (natural.length - 1);
    const scale = content / used;
    let x = margin;
    let rowHeight = 0;
    for (const item of natural) {
      const width = item.width * scale;
      const height = item.height * scale;
      commands.push({
        type: "panel.add",
        panelId: item.panelId,
        assetId: item.assetId,
        frameMm: { x, y, width, height },
      });
      rowHeight = Math.max(rowHeight, height);
      x += width + gutter;
    }
    y += rowHeight + gutter;
    bottom = y - gutter;
  }
  return [
    {
      type: "canvas.set",
      canvas: {
        widthMm: canvasWidth,
        heightMm: Math.ceil((bottom + margin) * 1000) / 1000,
        heightMode: "fixed",
        background: "#FFFFFF",
        marginsMm: { top: 4, right: 4, bottom: 4, left: 4 },
      },
    },
    ...commands,
  ];
}

async function sharpPng(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 40, g: 40, b: 40 } } }).png().toBuffer();
}

async function createProject(app: ReturnType<typeof createServer>, title: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { "idempotency-key": `project-${title}`, "content-type": "application/json" },
    payload: { title },
  });
  expect(created.statusCode).toBe(201);
  return created.json().project.id as string;
}

async function transact(app: ReturnType<typeof createServer>, projectId: string, revision: number, key: string, commands: unknown[]) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/transactions`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload: { baseRevision: revision, commands },
  });
  expect(response.statusCode, response.body).toBe(200);
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
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  const asset = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/assets/${response.json().assetId as string}` });
  return asset.json() as Asset;
}

async function exportJob(
  app: ReturnType<typeof createServer>,
  projectId: string,
  payload: ExportRequest,
  key: string,
): Promise<{ artifactId: string; diagnostics: Diagnostic[] }> {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/exports`,
    headers: { "idempotency-key": key, "content-type": "application/json" },
    payload,
  });
  expect(response.statusCode, response.body).toBe(202);
  const job = await jobOf(app, response.json().jobId as string);
  expect(job.status, JSON.stringify(job.error)).toBe("succeeded");
  if (!job.result || !("artifactId" in job.result)) throw new Error("missing artifact");
  return { artifactId: job.result.artifactId, diagnostics: "diagnostics" in job.result ? job.result.diagnostics : [] };
}

async function packaged(app: ReturnType<typeof createServer>, projectId: string, revision: number, includeBundledFonts: boolean, key: string) {
  const job = await exportJob(app, projectId, { revision, format: "project", options: { includeBundledFonts } }, key);
  expect(job.diagnostics.some((item) => item.messageKey === "font.filesNotVendored")).toBe(false);
  return download(app, `/api/v1/artifacts/${job.artifactId}/download`);
}

async function jobOf(app: ReturnType<typeof createServer>, jobId: string): Promise<Job> {
  const job = await waitForTerminalJob(app, jobId);
  return job;
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
