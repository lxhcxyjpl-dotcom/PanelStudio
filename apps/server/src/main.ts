import os from "node:os";
import path from "node:path";
import { createServer } from "./index.js";

const port = Number(process.env.PORT ?? "3001");
const dataDir = process.env.DATA_DIR ?? path.join(os.tmpdir(), `panelstudio-${process.pid}`);
const app = createServer({ dataDir });
await app.listen({ host: "127.0.0.1", port });
console.log(`PanelStudio API listening on ${port}`);
