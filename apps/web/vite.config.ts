import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Connect, type Plugin } from "vite";

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fonts");
const fontFiles = ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf", "NotoSansSC-Regular.ttf", "NotoSansSC-Bold.ttf"];

function serveFont(req: Connect.IncomingMessage, res: import("node:http").ServerResponse, next: Connect.NextFunction): void {
  const name = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/").replace(/^\//u, "");
  if (!fontFiles.includes(name)) {
    next();
    return;
  }
  const file = path.join(fontsDir, name);
  if (!existsSync(file)) {
    next();
    return;
  }
  res.setHeader("content-type", "font/ttf");
  res.setHeader("cache-control", "public, max-age=3600");
  createReadStream(file).pipe(res);
}

function bundledFonts(): Plugin {
  return {
    name: "panelstudio-fonts",
    configureServer(server) {
      server.middlewares.use("/fonts", serveFont);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/fonts", serveFont);
    },
    writeBundle(options) {
      const dest = path.join(options.dir ? path.resolve(options.dir) : path.resolve("dist"), "fonts");
      mkdirSync(dest, { recursive: true });
      for (const name of fontFiles) copyFileSync(path.join(fontsDir, name), path.join(dest, name));
    },
  };
}

export default defineConfig({
  plugins: [react(), bundledFonts()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.PANELSTUDIO_API ?? "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
});
