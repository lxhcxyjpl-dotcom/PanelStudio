import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_VERSIONS, createDefaultFigureDocument, type Candidate, type Job } from "@panelstudio/contracts";
import { api, type DownloadedFile } from "../api/client";
import { cancelAiPrompt, generateAi, generateLayout, resetCandidateSession } from "./candidate-session";
import { patch, useWorkspace } from "./store";

function deferred<T>() {
  let complete!: (value: T) => void, fail!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { complete = resolve; fail = reject; });
  return { complete, fail, promise };
}
const alpha = randomUUID(), beta = randomUUID();
const root = { revision: 1, document: createDefaultFigureDocument(), documentHash: "1".repeat(64), history: { canUndo: true, canRedo: false } };
const options = { includePreviewImage: false, visualReview: false };
function open(id: string) {
  resetCandidateSession(id);
  patch({ projectId: id, confirmed: root, liveMessage: "project ready", draft: null });
}
function card(projectId: string): Candidate {
  return { id: randomUUID(), sourceJobId: null, parentCandidateId: null, baseRevision: 1, projectId, origin: "ai", validationMode: "edit", previewDocument: root.document,
    summary: "move A", commands: [], resultDocumentHash: root.documentHash, diagnostics: [], engineVersion: ENGINE_VERSIONS.layout, fontRegistryVersion: ENGINE_VERSIONS.fontRegistry };
}
function success(projectId: string, candidate: Candidate, id: string): Job {
  return { id, kind: "ai_layout", projectId, status: "succeeded", phase: "ready", progress: null, createdAt: "2026-11-10T00:00:00Z",
    startedAt: "2026-11-10T00:00:00Z", finishedAt: "2026-11-10T00:00:01Z", result: { kind: "candidates", candidates: [candidate] }, error: null };
}
describe("candidate request ownership", () => {
  beforeEach(() => {
    open(alpha);
    vi.spyOn(api, "aiHistory").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(api, "preview").mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => { resetCandidateSession(null); vi.restoreAllMocks(); });

  it.each(["success", "error"] as const)("ignores a late %s after changing projects", async (outcome) => {
    const id = randomUUID();
    vi.spyOn(api,"aiLayout").mockResolvedValue({ jobId: id });
    const result = deferred<Job>();
    const job = vi.spyOn(api, "job").mockReturnValue(result.promise);
    const task = generateAi("first", options);
    await vi.waitFor(() => expect(job).toHaveBeenCalledWith(id));
    open(beta);
    if (outcome === "success") result.complete(success(alpha,card(alpha),id));
    else result.fail(new Error("late"));
    await task;
    expect(useWorkspace.getState()).toMatchObject({ projectId: beta, cards: [], aiStatus: { phase:"idle" }, liveMessage: "project ready" });
  });

  it("does not publish an old job when its acknowledgement arrives after cancel and a new send", async () => {
    const old = randomUUID(), next = randomUUID(), candidate = card(alpha);
    const accepted = deferred<{ jobId:string }>();
    vi.spyOn(api,"aiLayout").mockReturnValueOnce(accepted.promise).mockResolvedValueOnce({ jobId:next });
    const cancelled = vi.spyOn(api,"cancelJob").mockResolvedValue(success(alpha,card(alpha),old));
    vi.spyOn(api,"job").mockResolvedValue(success(alpha,candidate,next));
    const first = generateAi("one",options);
    await cancelAiPrompt();
    await generateAi("two",options);
    accepted.complete({ jobId: old }); await first;
    expect(cancelled).toHaveBeenCalledWith(old, expect.any(String));
    expect(useWorkspace.getState()).toMatchObject({ activeCandidateId: candidate.id, aiStatus:{ phase:"idle" }, compareMode:"draft" });
  });

  it("rejects a late thumbnail for the same candidate after a replacement request", async () => {
    const candidate = card(alpha);
    vi.spyOn(api,"layoutCandidates").mockResolvedValue({ candidates:[candidate] });
    const previewId = randomUUID(), artifactId = randomUUID();
    vi.mocked(api.preview).mockResolvedValue({ jobId:previewId });
    vi.spyOn(api,"job").mockResolvedValue({ id:previewId, projectId:alpha, kind:"preview", status:"succeeded", phase:"ready", progress:null,
      createdAt: "2026-11-10T00:00:00Z", startedAt:null, finishedAt:"2026-11-10T00:00:01Z", result:{artifactId}, error:null });
    const late = deferred<DownloadedFile>(), png = { blob: new Blob(["png"]), filename:"figure.png", mediaType:"image/png" };
    const download = vi.spyOn(api,"download").mockReturnValueOnce(late.promise).mockResolvedValue(png);
    await generateLayout({ family:"auto" });
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    await generateLayout({ family:"auto" });
    await vi.waitFor(() => expect(useWorkspace.getState().cards[0]?.previewUrl).toBeTruthy());
    const url = useWorkspace.getState().cards[0]!.previewUrl;
    late.complete(png); await late.promise; await Promise.resolve();
    expect(useWorkspace.getState().cards[0]?.previewUrl).toBe(url);
  });
});
