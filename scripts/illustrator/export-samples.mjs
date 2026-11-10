import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverRoot = path.join(root, "apps/server");
const fromServer = createRequire(path.join(serverRoot, "package.json"));
const { createServer: createVite } = await import(pathToFileURL(fromServer.resolve("vite")).href);
const output = path.resolve(process.argv[2] ?? "test-results/illustrator-input");
mkdirSync(output, { recursive: true });
const vite = await createVite({ root: serverRoot, configFile: false, logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
const { createServer } = await vite.ssrLoadModule("/src/index.ts");
const { resolvePanelLabel } = await vite.ssrLoadModule("@panelstudio/core");
const app = createServer({ dataDir: mkdtempSync(path.join(tmpdir(), "panelstudio-svg-")) });
const base = await app.listen({ host: "127.0.0.1", port: 0 });

async function call(route, method = "GET", body) {
  const upload = body instanceof FormData;
  const response = await fetch(base + "/api/v1" + route, { method,
    headers: { ...(method === "POST" ? { "Idempotency-Key": randomUUID() } : {}),
      ...(body && !upload ? { "Content-Type": "application/json" } : {}) },
    body: upload ? body : body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(await response.text());
  return response;
}
async function json(route, method, body) { return (await call(route, method, body)).json(); }
async function finish(jobId) {
  for (let i = 0; i < 600; i++) {
    const job = await json("/jobs/" + jobId);
    if (job.status === "succeeded") return job.result;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(JSON.stringify(job.error));
    await delay(100);
  }
  throw new Error("Artifact job timed out.");
}
const samples = [
  { name: "01-mixed", inputs: ["vector", "png", "jpeg"], width: 180, height: 86, size: 9, weight: 700 },
  { name: "02-cropped", inputs: ["jpeg", "vector", "png"], width: 160, height: 75, size: 10, weight: 400, crop: true },
  { name: "03-cjk", inputs: ["vector", "heat", "jpeg"], width: 175, height: 83, size: 11, weight: 700, texts: ["图甲", "(β)", "III"] },
  { name: "04-alpha", inputs: ["alpha", "png", "vector"], width: 155, height: 85, size: 8, weight: 400, opacity: 62 },
  { name: "05-repeated-vector", inputs: ["vector", "vector", "heat"], width: 172, height: 80, size: 12, weight: 700, texts: ["(A)", "(B)", "(C)"] },
];
const paths = { vector: "fixtures/mixed/panel-vector.svg", png: "fixtures/mixed/raster.png",
  jpeg: "fixtures/mixed/photo.jpg", heat: "examples/synthetic-six/assets/heatmap.png", alpha: "fixtures/mixed/panel-vector.svg" };
const manifest = [];
try {
  for (const sample of samples) {
    const project = (await json("/projects", "POST", { title: sample.name })).project.id;
    const prefix = "/projects/" + project;
    const original = (await json(prefix + "/document")).document;
    const perPanel = [];
    const commands = [{ type: "canvas.set", canvas: { ...original.canvas, widthMm: sample.width, heightMm: sample.height, heightMode: "fixed" } },
      { type: "label.setStyle", labelStyle: { ...original.labelStyle, fontId: sample.name === "03-cjk" ? "noto-sans-sc" : "noto-sans",
        fontWeight: sample.weight, fontSizePt: sample.size } }];
    for (const [index, kind] of sample.inputs.entries()) {
      const filename = paths[kind];
      let bytes = readFileSync(path.join(root, filename));
      if (kind === "alpha") bytes = Buffer.from(bytes.toString("utf8").replace('<g id="mark"', '<g opacity="0.62" id="mark"'));
      const form = new FormData();
      form.append("file", new Blob([bytes]), path.basename(filename));
      const receipt = await json(prefix + "/assets", "POST", form);
      await finish(receipt.jobId);
      const asset = await json(prefix + "/assets/" + receipt.assetId);
      const id = randomUUID();
      const crop = sample.crop && index === 0 ? { x: 0.1, y: 0.15, width: 0.75, height: 0.7 }
        : { x: 0, y: 0, width: 1, height: 1 };
      const width = 34;
      const height = width * asset.normalized.viewport.height * crop.height / (asset.normalized.viewport.width * crop.width);
      const frame = { x: 12 + index * 47, y: 18 + index * 7, width, height };
      commands.push({ type: "panel.add", assetId: asset.id, panelId: id, frameMm: frame, cropNormalized: crop });
      if (sample.texts) commands.push({ type: "label.setOverrides", items: [{ panelId: id, value: {
        text: sample.texts[index], visible: null, offsetMm: null, placement: null, typography: null } }] });
      perPanel.push({ id, frame });
    }
    const saved = await json(prefix + "/transactions", "POST", { baseRevision: 0, commands });
    for (const panel of perPanel) {
      const label = resolvePanelLabel(saved.document, panel.id);
      Object.assign(panel, { text: label.text, size: sample.size, font: label.fontFamily,
        weight: sample.weight, x: label.x, y: label.y });
    }
    for (const format of ["svg", "png"]) {
      const receipt = await json(prefix + "/exports", "POST", { revision: saved.revision, format,
        options: format === "svg" ? { includeMetadata: true } : { dpi: 150 } });
      const result = await finish(receipt.jobId);
      const content = await call("/artifacts/" + result.artifactId + "/download");
      writeFileSync(path.join(output, sample.name + "." + format), Buffer.from(await content.arrayBuffer()));
    }
    manifest.push({ name: sample.name, width: sample.width, height: sample.height, panels: perPanel,
      rasters: sample.inputs.filter((v) => ["png", "jpeg", "heat"].includes(v)).length, opacity: sample.opacity ?? null });
    console.log("Exported " + sample.name);
  }
  writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
} finally {
  await app.close();
  await vite.close();
}
