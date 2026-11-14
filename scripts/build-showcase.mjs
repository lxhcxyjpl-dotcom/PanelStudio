// Build the public demonstration through the real import/layout/transaction/export API.
// Uses an isolated temporary database. Never reads the user's provider or project data.
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverRoot = path.join(root, "apps/server");
const requireServer = createRequire(path.join(serverRoot, "package.json"));
const { createServer: createVite } = await import(pathToFileURL(requireServer.resolve("vite")).href);
const output = path.join(root, "apps/web/public/showcase");
mkdirSync(output, { recursive: true });
const vite = await createVite({ root: serverRoot, configFile: false, logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
const { createServer } = await vite.ssrLoadModule("/src/index.ts");
const { resolvePanelLabel, translateSelection } = await vite.ssrLoadModule("@panelstudio/core");
const { placePanelCommands } = await vite.ssrLoadModule(path.join(root, "apps/web/src/model/place.ts").replaceAll("\\", "/"));
const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-showcase-"));
const app = createServer({ dataDir });
const base = await app.listen({ host: "127.0.0.1", port: 0 });
async function call(route, method = "GET", body) {
  const form = body instanceof FormData;
  const response = await fetch(base + "/api/v1" + route, { method,
    headers: { ...(method !== "GET" ? { "Idempotency-Key": randomUUID() } : {}), ...(body && !form ? { "Content-Type": "application/json" } : {}) },
    body: form ? body : body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(route + ": " + await response.text());
  return response;
}
async function json(route, method, body) { return (await call(route, method, body)).json(); }
async function finish(id) {
  for (let i = 0; i < 300; i++) {
    const job = await json("/jobs/" + id);
    if (job.status === "succeeded") return job.result;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(JSON.stringify(job.error));
    await delay(100);
  }
  throw new Error("Showcase job timed out");
}
const families = [
  { id: "single-cell", files: ["panel-a.svg", "panel-b.svg", "panel-c.svg", "panel-d.svg", "panel-e.svg", "panel-f.svg"] },
  { id: "molecular", files: ["panel-e.svg", "panel-c.svg", "panel-f.svg"] },
  { id: "microscopy", files: ["microscopy-blue.png", "microscopy-green.png", "microscopy-merged.png"] },
  { id: "experimental", files: ["experimental-bands.png", "experimental-bars.svg", "panel-f.svg"] },
];
const catalog = [];
try {
  for (const family of families) {
    const id = (await json("/projects", "POST", { title: `${family.id} · Synthetic demo` })).project.id;
    const prefix = "/projects/" + id;
    const original = (await json(prefix + "/document")).document;
    const assets = [];
    const assetUrls = {};
    for (const [i, name] of family.files.entries()) {
      const form = new FormData();
      form.append("file", new Blob([readFileSync(path.join(root, "examples/showcase/assets", name))]), name);
      const receipt = await json(prefix + "/assets", "POST", form);
      await finish(receipt.jobId);
      const asset = await json(prefix + "/assets/" + receipt.assetId);
      if (asset.status !== "ready") throw new Error(name + " is not ready");
      const response = await call(prefix + "/assets/" + asset.id + "/content");
      const filename = `${family.id}-${i}.${name.endsWith("svg") ? "svg" : "png"}`;
      writeFileSync(path.join(output, filename), Buffer.from(await response.arrayBuffer()));
      assetUrls[asset.id] = "/showcase/" + filename;
      assets.push({ assetId: asset.id, panelId: randomUUID(), viewport: asset.normalized.viewport });
    }
    const imported = await json(prefix + "/transactions", "POST", { baseRevision: 0, commands: placePanelCommands(original, assets) });
    const layouts = await json(prefix + "/layout-candidates", "POST", { baseRevision: imported.revision, request: { family: "auto" }, maxCandidates: 3 });
    if (!layouts.candidates?.length) throw new Error("No layout for " + family.id);
    const arranged = await json(prefix + "/transactions", "POST", { baseRevision: imported.revision, candidateId: layouts.candidates[0].id });
    const selected = arranged.document.panelOrder.slice(1, 3);
    const refined = await json(prefix + "/transactions", "POST", { baseRevision: arranged.revision, commands: [translateSelection(arranged.document, selected, 2, 0)] });
    const scene = snapshot => ({ revision: snapshot.revision, documentHash: snapshot.documentHash,
      width: snapshot.document.canvas.widthMm, height: snapshot.document.canvas.heightMm,
      panels: snapshot.document.stackOrder.map(panelId => {
        const panel = snapshot.document.panels[panelId];
        const label = resolvePanelLabel(snapshot.document, panelId);
        return { id: panelId, src: assetUrls[panel.assetId], frame: panel.frameMm,
          label: label ? { text: label.text, x: label.x, y: label.y, size: label.fontSizeUser, font: label.fontFamily, weight: label.fontWeight, color: label.color } : null };
      }) });
    const exports = {};
    for (const format of ["svg", "png", "project"]) {
      const receipt = await json(prefix + "/exports", "POST", { revision: refined.revision, format,
        options: format === "svg" ? { includeMetadata: true } : format === "png" ? { dpi: 150 } : { includeBundledFonts: false } });
      const result = await finish(receipt.jobId);
      const response = await call("/artifacts/" + result.artifactId + "/download");
      const bytes = Buffer.from(await response.arrayBuffer());
      const filename = family.id + "." + (format === "project" ? "figurezip" : format);
      writeFileSync(path.join(output, filename), bytes);
      exports[format] = { url: "/showcase/" + filename, sha256: createHash("sha256").update(bytes).digest("hex"), diagnostics: result.diagnostics ?? [] };
    }
    // The downloadable package must actually reopen, not merely look like an export.
    const form = new FormData();
    form.append("file", new Blob([readFileSync(path.join(output, family.id + ".figurezip"))]), family.id + ".figurezip");
    const receipt = await json("/project-imports", "POST", form);
    const reopened = await finish(receipt.jobId);
    const checked = await json("/projects/" + reopened.projectId + "/document");
    if (checked.documentHash !== refined.documentHash) throw new Error("Package round-trip changed " + family.id);
    catalog.push({ id: family.id, synthetic: true, replay: "recorded-domain-commands", source: "examples/showcase/generate.py",
      states: { imported: scene(imported), arranged: scene(arranged), refined: scene(refined) }, exports, roundTripHash: checked.documentHash });
    console.log("Built and reopened " + family.id);
  }
  writeFileSync(path.join(output, "catalog.json"), JSON.stringify({ version: 1, examples: catalog }, null, 2) + "\n");
} finally { await app.close(); await vite.close(); }
