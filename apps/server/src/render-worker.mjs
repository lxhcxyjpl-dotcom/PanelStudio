import { parentPort } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Like the server entry point, load the workspace TypeScript modules once.
const vite = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  configFile: false, appType: "custom", logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
});
const { executeRender } = await vite.ssrLoadModule("/src/render-task.ts");
await vite.close();

parentPort.on("message", (task) => {
  try {
    const result = executeRender(task);
    const bytes = Uint8Array.from(result.bytes);
    parentPort.postMessage({ ...result, bytes }, [bytes.buffer]);
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : "Rendering failed." });
  }
});
