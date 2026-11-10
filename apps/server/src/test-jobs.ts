import type { FastifyInstance } from "fastify";
import type { Job } from "@panelstudio/contracts";
import { setTimeout as delay } from "node:timers/promises";

export async function waitForTerminalJob(app: FastifyInstance, jobId: string): Promise<Job> {
  const deadline = Date.now() + 25_000;
  do {
    const response = await app.inject({ method: "GET", url: "/api/v1/jobs/" + jobId });
    if (response.statusCode !== 200) throw new Error(response.body);
    const job = response.json<Job>();
    if (job.status !== "queued" && job.status !== "running") return job;
    await delay(15);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for job " + jobId);
}
