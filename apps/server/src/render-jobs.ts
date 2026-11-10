import { randomUUID } from "node:crypto";
import { ENGINE_VERSIONS, type Diagnostic, type Job } from "@panelstudio/contracts";
import { appendJobEvent, getJobDetail, getProject, immediate, insertArtifact, insertIdempotency,
  insertJob, updateJobState, type JobDetail } from "./db.js";
import type { AppContext } from "./pipeline.js";
import { ApiException } from "./http.js";

export type ArtifactOutput = {
  bytes: Buffer; mediaType: string; filename: string; rendererVersion: string; diagnostics: Diagnostic[];
};
type Source = { projectId: string; revision: number; candidateId: string | null; format: "preview" | "svg" | "png" | "project" };

function transition(ctx: AppContext, job: JobDetail, status: Job["status"], phase: string,
  result: Job["result"] = null, error: Job["error"] = null) {
  const now = ctx.now();
  updateJobState(ctx.db, job.id, { status, phase, result, error,
    startedAt: job.startedAt ?? (status === "running" ? now : null), finishedAt: status === "running" ? null : now });
  const event = { running: "job.started", succeeded: "job.completed", failed: "job.failed", cancelled: "job.cancelled", queued: "job.queued" }[status];
  appendJobEvent(ctx.db, { jobId: job.id, event, payloadJson: { status, phase, progress: null }, createdAt: now });
}

function active(ctx: AppContext, id: string, source: Source) {
  const job = getJobDetail(ctx.db, id);
  if (!job || (job.status !== "queued" && job.status !== "running")) return null;
  const project = getProject(ctx.db, source.projectId);
  if (job.cancelRequested || !project || project.deletedAt) {
    transition(ctx, job, "cancelled", "cancelled");
    return null;
  }
  const versions = (job.input as { engines?: typeof ENGINE_VERSIONS }).engines;
  if (versions?.svg !== ENGINE_VERSIONS.svg || versions?.fontRegistry !== ENGINE_VERSIONS.fontRegistry ||
      versions?.layout !== ENGINE_VERSIONS.layout) {
    transition(ctx, job, "failed", "failed", null, { code: "CANDIDATE_STALE", message: "The rendering engine changed." });
    return null;
  }
  return job;
}

// The caller resolves idempotency, validates the immutable source and enters this
// function without awaiting, so the accepted job and its replay key are one write.
export function queueRenderJob(ctx: AppContext, source: Source, input: unknown, scope: string, key: string,
  requestHash: string, produce: () => Promise<ArtifactOutput>) {
  const id = randomUUID();
  const body = { jobId: id };
  const kind = source.format === "preview" ? "preview" : "export";
  immediate(ctx.db, () => {
    const now = ctx.now();
    insertJob(ctx.db, { id, projectId: source.projectId, kind, status: "queued", phase: "queued", result: null, error: null,
      inputJson: { request: input, engines: ENGINE_VERSIONS }, createdAt: now, startedAt: null, finishedAt: null });
    appendJobEvent(ctx.db, { jobId: id, event: "job.queued", payloadJson: { status: "queued", phase: "queued", progress: null }, createdAt: now });
    insertIdempotency(ctx.db, { scope, key, requestHash, httpStatus: 202, responseJson: JSON.stringify(body), createdAt: now });
  });
  const work = new Promise<void>((resolve) => setImmediate(resolve)).then(async () => {
    const claimed = immediate(ctx.db, () => {
      const current = active(ctx, id, source);
      if (!current) return false;
      transition(ctx, current, "running", "rendering");
      return true;
    });
    if (!claimed) return;
    try {
      const output = await produce();
      // Store immutable bytes outside the transaction. Only the guarded transaction
      // publishes an artifact ID, the terminal job and its terminal event.
      if (!immediate(ctx.db, () => active(ctx, id, source))) return;
      const blob = ctx.blobs.put(output.bytes);
      immediate(ctx.db, () => {
        const job = active(ctx, id, source);
        if (!job) return;
        const artifactId = randomUUID();
        insertArtifact(ctx.db, { id: artifactId, projectId: source.projectId, revision: source.revision,
          candidateId: source.candidateId, kind: source.format, mediaType: output.mediaType, filename: output.filename,
          byteLength: output.bytes.byteLength, sha256: blob.sha256, blobPath: blob.relativePath,
          rendererVersion: output.rendererVersion, createdAt: ctx.now() });
        const result = source.format === "preview" ? { artifactId }
          : { artifactId, revision: source.revision, format: source.format, diagnostics: output.diagnostics };
        transition(ctx, job, "succeeded", "ready", result);
      });
    } catch (error) {
      immediate(ctx.db, () => {
        const job = active(ctx, id, source);
        if (job) transition(ctx, job, "failed", "failed", null, error instanceof ApiException
          ? { code: error.code, message: error.message, details: error.details }
          : { code: "DOCUMENT_INVALID", message: "The renderer could not create the artifact." });
      });
    }
  });
  ctx.renderJobs.add(work);
  void work.then(() => ctx.renderJobs.delete(work), () => ctx.renderJobs.delete(work));
  return { status: 202, body };
}

export function finishInterruptedRenders(ctx: AppContext): void {
  immediate(ctx.db, () => {
    const interrupted = ctx.db.prepare("SELECT id FROM jobs WHERE kind IN ('preview','export') AND status IN ('queued','running')").all() as { id: string }[];
    for (const { id } of interrupted) {
      const job = getJobDetail(ctx.db, id)!;
      if (job.cancelRequested) transition(ctx, job, "cancelled", "cancelled");
      else transition(ctx, job, "failed", "interrupted", null, { code: "SERVER_RESTARTED", message: "Rendering was interrupted. Request the artifact again." });
    }
  });
}
