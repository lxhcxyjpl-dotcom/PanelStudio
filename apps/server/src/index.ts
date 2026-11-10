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
 * Phase 3 server: phase 1 import and export, the phase 2 edit kernel,
 * and automatic layout candidates. AI and the workspace UI stay later phases.
 * Domain commands, undo, redo, candidates, and project files survive a restart.
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
