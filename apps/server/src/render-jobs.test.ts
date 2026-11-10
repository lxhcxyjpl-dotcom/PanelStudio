import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createServer } from "./index.js";
import { waitForTerminalJob } from "./test-jobs.js";

describe("background preview publication", () => {
  it("acknowledges first, allows edits, and never publishes after cancellation or deletion", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "ps-render-"));
    const app = createServer({ dataDir });
    const post = (url: string, payload: object, key = randomUUID()) =>
      app.inject({ method: "POST", url: "/api/v1" + url, payload, headers: { "idempotency-key": key } });
    const project = async () => (await post("/projects", { title: "Worker test" })).json().project.id as string;
    try {
      const id = await project();
      const prefix = "/projects/" + id;
      const request = { source: { revision: 0 }, pixelWidth: 1200 };
      const key = randomUUID();
      const accepted = await post(prefix + "/previews", request, key);
      expect(accepted.statusCode).toBe(202);
      const jobId = accepted.json().jobId;
      expect((await post(prefix + "/previews", request, key)).json().jobId).toBe(jobId);
      const initial = (await app.inject("/api/v1/jobs/" + jobId)).json();
      expect(["queued", "running"]).toContain(initial.status);
      const original = (await app.inject("/api/v1" + prefix + "/document")).json().document;
      const edit = await post(prefix + "/transactions", { baseRevision: 0, commands: [
        { type: "canvas.set", canvas: { ...original.canvas, widthMm: 190 } },
      ] });
      expect(edit.json().revision).toBe(1);
      expect((await app.inject("/api/v1/health")).statusCode).toBe(200);
      const cancelled = await post(prefix + "/previews", { source: { revision: 1 }, pixelWidth: 1400 });
      const cancelledId = cancelled.json().jobId;
      await post("/jobs/" + cancelledId + "/cancel", {});
      expect((await waitForTerminalJob(app, cancelledId)).status).toBe("cancelled");
      const other = await project();
      const unfinished = await post("/projects/" + other + "/previews", request);
      await app.inject({ method: "DELETE", url: "/api/v1/projects/" + other });
      expect((await waitForTerminalJob(app, unfinished.json().jobId)).status).toBe("cancelled");
      const complete = await waitForTerminalJob(app, jobId);
      expect(complete.status).toBe("succeeded");
      if (complete.kind !== "preview" || complete.status !== "succeeded") throw new Error("Preview failed");
      const file = await app.inject("/api/v1/artifacts/" + complete.result.artifactId + "/download");
      expect(file.rawPayload.readUInt32BE(16)).toBe(1200);
      expect(file.rawPayload.readUInt32BE(20)).toBe(800);
      const db = new Database(path.join(dataDir, "panelstudio.sqlite"), { readonly: true });
      try {
        expect(db.prepare("SELECT projectId,revision FROM artifacts").all()).toEqual([{ projectId: id, revision: 0 }]);
        expect(db.prepare("SELECT count(*) n FROM job_events WHERE jobId=? AND event='job.completed'").get(jobId)).toEqual({ n: 1 });
        expect(db.prepare("SELECT count(*) n FROM job_events WHERE jobId=? AND event='job.completed'").get(cancelledId)).toEqual({ n: 0 });
      } finally { db.close(); }
    } finally {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
