import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  registerAjvFormats,
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from "@fastify/type-provider-typebox";
import Fastify, { type FastifyInstance } from "fastify";
import { drainAiJobs, failInterruptedAiJobs } from "./ai-jobs.js";
import { BlobStore } from "./blobs.js";
import { openDatabase } from "./db.js";
import type { AppContext } from "./pipeline.js";
import { registerRoutes } from "./routes.js";

export type ServerOptions = {
  dataDir?: string;
  /** Tests leave AI jobs queued until drainAiJobs is called. */
  deferAiJobs?: boolean;
  aiFetch?: typeof fetch;
};

const drains = new WeakMap<FastifyInstance, () => Promise<void>>();

/**
 * Phase 5 server: import, export, the edit kernel, layout candidates, and
 * OpenAI-compatible AI layout jobs. A restart fails an in-flight provider
 * call instead of sending it again. Domain commands, undo, redo, candidates,
 * and project files survive a restart.
 */
export function createServer(options: ServerOptions = {}) {
  registerAjvFormats();
  const dataDir = options.dataDir ?? path.join(process.cwd(), ".panelstudio");
  const db = openDatabase(dataDir);
  const ctx: AppContext = {
    db,
    blobs: new BlobStore(dataDir),
    now: () => new Date().toISOString(),
    dataDir,
    deferAiJobs: options.deferAiJobs,
    aiFetch: options.aiFetch,
  };
  failInterruptedAiJobs(ctx);
  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    bodyLimit: 512 * 1024 * 1024,
  })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler);
  registerRoutes(app, ctx);
  drains.set(app, () => drainAiJobs(ctx));
  app.addHook("onClose", async () => {
    db.close();
  });
  return app;
}

export function drainServerAiJobs(app: FastifyInstance): Promise<void> {
  const drain = drains.get(app);
  return drain ? drain() : Promise.resolve();
}
