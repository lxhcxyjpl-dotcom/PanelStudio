import { createServer as createVite } from "vite";

const vite = await createVite({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
await vite.ssrLoadModule("./src/main.ts");
await vite.close();
