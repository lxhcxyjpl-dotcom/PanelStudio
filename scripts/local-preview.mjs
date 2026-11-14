import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdirSync } from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataDir = process.argv[2];
if (!dataDir) throw new Error("Pass a dedicated preview data directory: node scripts/local-preview.mjs <directory>");
mkdirSync(dataDir, { recursive: true });
const serverRoot = path.join(root, "apps/server");
const requireServer = createRequire(path.join(serverRoot, "package.json"));
const { createServer: createVite } = await import(pathToFileURL(requireServer.resolve("vite")).href);
const loader = await createVite({ root: serverRoot, configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false, watch: null, ws: false } });
const { createServer } = await loader.ssrLoadModule("/src/index.ts");
const api = createServer({ dataDir: path.resolve(dataDir) });
const apiPort = Number(process.env.PANELSTUDIO_PREVIEW_API_PORT ?? 4341);
const webPort = Number(process.env.PANELSTUDIO_PREVIEW_WEB_PORT ?? 5283);
await api.listen({ host: "127.0.0.1", port: apiPort });
const webRoot = path.join(root, "apps/web");
const web = await createVite({ root: webRoot, configFile: path.join(webRoot, "vite.config.ts"), server: { host: "127.0.0.1", port: webPort, strictPort: true,
  proxy: { "/api": { target: "http://127.0.0.1:" + apiPort, changeOrigin: true } } } });
await web.listen();
console.log("PanelStudio preview: http://127.0.0.1:" + webPort);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await web.close(); await api.close(); await loader.close(); process.exit(0); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
