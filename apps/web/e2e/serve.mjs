import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createVite } from "vite";

// Own the listeners directly so teardown never depends on a shell killing
// descendant processes. Each run gets an isolated project database.
export default async function serve() {
  const apiPort = Number(process.env.PANELSTUDIO_E2E_API_PORT ?? 3001);
  const webPort = Number(process.env.PANELSTUDIO_E2E_WEB_PORT ?? 5173);
  const host = "127.0.0.1";
  const apiRoot = fileURLToPath(new URL("../../server/", import.meta.url));
  const webRoot = fileURLToPath(new URL("../", import.meta.url));
  const loader = await createVite({ root: apiRoot, configFile: false, appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: null, ws: false }, optimizeDeps: { noDiscovery: true } });
  let api, web;
  async function close() {
    try { if (web) await web.close(); }
    finally { try { if (api) await api.close(); } finally { await loader.close(); } }
  }
  try {
    const server = await loader.ssrLoadModule("/src/index.ts");
    api = server.createServer({ dataDir: process.env.DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "panelstudio-e2e-")) });
    await api.listen({ host, port: apiPort });
    web = await createVite({ root: webRoot, configFile: path.join(webRoot, "vite.config.ts"),
      server: { host, port: webPort, strictPort: true, hmr: false, watch: null,
        proxy: { "/api": { target: "http://" + host + ":" + apiPort, changeOrigin: true } } } });
    await web.listen();
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
