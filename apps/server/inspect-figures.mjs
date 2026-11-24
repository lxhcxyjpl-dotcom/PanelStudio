import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const args = process.argv.slice(2);
const to = args.indexOf("--out");
const out = to >= 0 ? args.splice(to, 2)[1] : null;
if (!args.length || (to >= 0 && !out))
  throw Error("Usage: node apps/server/inspect-figures.mjs [--out directory] image.svg image.png …");
if (out) await mkdir(out, { recursive: true });
const root = fileURLToPath(new URL("./", import.meta.url));
const loader = await createServer({
  root,
  configFile: false,
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true },
});
let ocr;
try {
  const { extractFigureEvidence, readingImage, FigureOcr } =
    await loader.ssrLoadModule("/src/figure-evidence.ts");
  const { sniffMediaType, normalizeRaster } = await loader.ssrLoadModule("/src/raster.ts");
  const { normalizeSvg } = await loader.ssrLoadModule("@panelstudio/svg");
  ocr = new FigureOcr();
  const result = [];
  for (const file of args) {
    const original = await readFile(file),
      mediaType = sniffMediaType(original);
    if (!mediaType) throw Error("Unsupported image: " + path.basename(file));
    let source;
    if (mediaType === "image/svg+xml") {
      const s = normalizeSvg(original.toString("utf8"));
      source = { bytes: Buffer.from(s.svg), mediaType, ...s.viewport };
    } else {
      const r = await normalizeRaster(original, mediaType);
      source = { bytes: r.renderBytes, mediaType: "image/png", ...r.viewport };
    }
    const png = await readingImage(source);
    const evidence = await extractFigureEvidence(source, ocr, png);
    result.push({ file: path.basename(file), ...evidence });
    if (out) await writeFile(path.join(out, "reading-" + result.length + ".png"), png);
  }
  const json = JSON.stringify(result, null, 2);
  if (out) await writeFile(path.join(out, "evidence.json"), json);
  else process.stdout.write(json + "\n");
} finally {
  await ocr?.close();
  await loader.close();
}
