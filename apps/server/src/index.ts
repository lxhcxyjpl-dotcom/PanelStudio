import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  registerAjvFormats,
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { BlobStore } from "./blobs.js";
import { openDatabase } from "./db.js";
import { registerRoutes } from "./routes.js";

export type ServerOptions = {
  dataDir?: string;
};

/**
 * Phase 2 server: phase 1 import and export, plus the edit kernel.
 * Domain commands, undo, redo, and project files survive a process restart.
 * Layout, AI, previews, and the workspace UI stay later phases.
 */
export function createServer(options: ServerOptions = {}) {
  registerAjvFormats();
  const dataDir = options.dataDir ?? path.join(process.cwd(), ".panelstudio");
  const db = openDatabase(dataDir);
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    bodyLimit: 512 * 1024 * 1024,
  })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler);
  registerRoutes(app, {
    db,
    blobs: new BlobStore(dataDir),
    now: () => new Date().toISOString(),
  });
  app.addHook("onClose", async () => {
    db.close();
  });
  return app;
}
