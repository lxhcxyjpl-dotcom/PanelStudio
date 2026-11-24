import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import {
  AIHistoryPageSchema, type AIContext, type AIHistoryPage, type AIIntent, type AILayoutRequest,
  type Candidate, type FigureDocumentV1, type Job,
} from "@panelstudio/contracts";
import { hashFigureDocument } from "@panelstudio/core";
import type { FrozenScene } from "@panelstudio/ai";
import { createServer, drainServerAiJobs } from "./index.js";
import { waitForTerminalJob } from "./test-jobs.js";

type App = ReturnType<typeof createServer>;
type Respond = (scene: FrozenScene, prompt: string) => AIIntent | Promise<AIIntent>;
const opened: Array<{ app: App; dir: string }> = [];
const example = fileURLToPath(new URL("../../../examples/synthetic-six/synthetic-six.figurezip", import.meta.url));

afterEach(async () => {
  for (const { app, dir } of opened.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function setup(respond: Respond, deferAiJobs = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "panelstudio-refinement-"));
  const seen: FrozenScene[] = [];
  const wire: unknown[] = [];
  const app = createServer({ dataDir: dir, deferAiJobs, aiFetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    wire.push(body);
    const message = body.messages.find((m: { role: string }) => m.role === "user").content;
    const inputText: string = typeof message === "string" ? message : message[0].text;
    const [prompt, json] = inputText.slice(inputText.indexOf("PROMPT:\n") + 8).split("\nSCENE:\n");
    const scene = JSON.parse(json!.split("\nPROPOSAL:\n")[0]!) as FrozenScene;
    seen.push(scene);
    const intent = await respond(scene, prompt!);
    return Response.json({ choices: [{ message: { content: JSON.stringify(intent) } }] });
  } });
  opened.push({ app, dir });
  const headers = () => ({ "idempotency-key": randomUUID() });
  const config = async (imageInput = false) => {
    const reply = await app.inject({ method: "PUT", url: "/api/v1/settings/ai-provider", headers: headers(),
      payload: { adapter: "openai-compatible", model: "scripted-v02-test", baseUrl: "http://127.0.0.1:1/v1",
        capabilities: { imageInput, structuredOutput: "json_object" }, allowLocalEndpoint: true } });
    expect(reply.statusCode, reply.body).toBe(200);
  };
  await config();
  expect((await app.inject({ method: "PUT", url: "/api/v1/settings/ai-provider/secret", headers: headers(),
    payload: { secret: "temporary-refinement-test" } })).statusCode).toBe(200);
  const openedProject = await app.inject({ method: "POST", url: "/api/v1/project-imports",
    headers: { ...headers(), "content-type": "multipart/form-data; boundary=example" },
    payload: Buffer.concat([Buffer.from('--example\r\nContent-Disposition: form-data; name="file"; filename="six.figurezip"\r\nContent-Type: application/zip\r\n\r\n'),
      readFileSync(example), Buffer.from("\r\n--example--\r\n")]) });
  expect(openedProject.statusCode, openedProject.body).toBe(202);
  const importResult = (await app.inject({ method: "GET", url: `/api/v1/jobs/${openedProject.json().jobId}` })).json();
  expect(importResult.status, JSON.stringify(importResult)).toBe("succeeded");
  const projectId: string = importResult.result.projectId;
  const project = `/api/v1/projects/${projectId}`;
  const original = (await app.inject({ method: "GET", url: project + "/document" })).json() as { revision: number; document: FigureDocumentV1; documentHash: string };
  const post = (route: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: route, headers: headers(), payload });
  const enqueue = (prompt: string, options: Partial<AILayoutRequest> = {}) => post(project + "/ai-layouts", {
    baseRevision: original.revision, selectedPanelIds: [], replyLocale: "zh-CN", includePreviewImage: false, visualReview: false, prompt, ...options,
  });
  const readJob = async (id: string) => (await app.inject({ method: "GET", url: "/api/v1/jobs/" + id })).json() as Extract<Job, { kind: "ai_layout" }>;
  const turn = async (prompt: string, options: Partial<AILayoutRequest> = {}) => {
    const reply = await enqueue(prompt, options);
    expect(reply.statusCode, reply.body).toBe(202);
    await drainServerAiJobs(app);
    return readJob(reply.json().jobId);
  };
  const history = async (query = "") => {
    const response = await app.inject({ method: "GET", url: project + "/ai-history" + query });
    expect(response.statusCode, response.body).toBe(200);
    expect(Check(AIHistoryPageSchema, response.json())).toBe(true);
    return response.json() as AIHistoryPage;
  };
  return { app, dir, project, seen, wire, projectId, original, post, enqueue, turn, readJob, history, config };
}

function proposal(...actions: Extract<AIIntent, { kind: "proposal" }>["actions"]): AIIntent {
  return { version: 1, kind: "proposal", summary: "Fixture change", actions };
}

function candidate(job: Extract<Job, { kind: "ai_layout" }>): Candidate {
  if (job.status !== "succeeded" || job.result.kind !== "candidates" || !job.result.candidates[0]) throw new Error(JSON.stringify(job));
  return job.result.candidates[0];
}

describe("v0.2 frozen AI drafts", () => {
  it("edits a historical clarification answer from its frozen parent and leaves the original applied figure untouched", async () => {
    const f = await setup((scene,prompt) => prompt === "first" ? proposal({type:"set_label_style",patch:{sequence:"lower-alpha"}}) :
      prompt === "ask" ? {version:1,kind:"clarification",question:"How far?",options:["one", "two"]} :
        proposal({type:"move_by_mm",targets:[{kind:"panel",id:scene.selectedPanelIds[0]!}],dxMm:prompt === "two" ? 2 : 1,dyMm:0}));
    const b = f.original.document.panelOrder[1]!;
    const parent = candidate(await f.turn("first"));
    const question = await f.turn("ask",{context:{kind:"candidate",candidateId:parent.id},scope:"selection",selectedPanelIds:[b]});
    const originalAnswer = await f.turn("one",{context:{kind:"clarification",jobId:question.id}});
    const original = candidate(originalAnswer);
    await f.post(f.project+"/transactions",{baseRevision:f.original.revision,candidateId:original.id});
    const key = randomUUID(), payload = {kind:"ai",title:"Figure 2 · v2",jobId:originalAnswer.id,prompt:"two",replyLocale:"en-US",includePreviewImage:false,visualReview:false};
    const fork = () => f.app.inject({method:"POST",url:f.project+"/message-branches",headers:{"idempotency-key":key},payload});
    const reply = await fork(); expect(reply.statusCode,reply.body).toBe(201);
    const created = reply.json();
    expect((await fork()).json()).toEqual(created);
    const branch = "/api/v1/projects/"+created.projectId;
    const root = (await f.app.inject({url:branch+"/document"})).json();
    expect(root.documentHash).toBe(parent.resultDocumentHash);
    expect(root.revision).toBe(0);
    await drainServerAiJobs(f.app);
    const edited = candidate(await f.readJob(created.jobId));
    expect(edited.previewDocument.panels[b]!.frameMm.x).toBeCloseTo(parent.previewDocument.panels[b]!.frameMm.x+2);
    expect(f.seen.at(-1)!.previousTurns.map(turn=>turn.prompt)).toEqual(["first","ask"]);
    expect(f.seen.at(-1)!.selectedPanelIds).toEqual([b]);
    const history = (await f.app.inject({url:branch+"/ai-history"})).json();
    expect(history.items[0].prefix.map((v:{prompt:string})=>v.prompt)).toEqual(["first","ask"]);
    expect((await f.app.inject({url:f.project+"/document"})).json().documentHash).toBe(original.resultDocumentHash);
    expect((await f.app.inject({url:branch+"/document"})).json().documentHash).toBe(parent.resultDocumentHash);
    expect((await f.post(branch+"/message-branches",payload)).statusCode).toBe(422);
    const count = async () => (await f.app.inject({url:"/api/v1/projects"})).json().items.length;
    const n = await count();
    expect((await f.post(f.project+"/message-branches",{kind:"figure",title:"Invalid asset",revision:f.original.revision,assetIds:[randomUUID()]})).statusCode).toBe(404);
    expect(await count()).toBe(n);
  });
  it("replays three turns once, scopes the delta against its immediate parent and undoes the complete chain", async () => {
    const f = await setup((scene, prompt) => prompt === "order"
      ? proposal({ type: "set_label_style", patch: { sequence: "lower-alpha" } })
      : prompt === "style" ? proposal({ type: "set_label_style", patch: { fontSizePt: 9, color: "#333333" } })
      : proposal({ type: "move_by_mm", targets: [{ kind: "panel", id: scene.selectedPanelIds[0]! }], dxMm: 1, dyMm: 0 }));
    const [a, b, c] = f.original.document.panelOrder as [string, string, string];
    const j1 = await f.turn("order");
    const one = candidate(j1);
    const j2 = await f.turn("style", { context: { kind: "candidate", candidateId: one.id }, scope: "selection", selectedPanelIds: [b, c] });
    const two = candidate(j2);
    const j3 = await f.turn("move", { context: { kind: "candidate", candidateId: two.id }, selectedPanelIds: [a] });
    const three = candidate(j3);
    expect(one).toMatchObject({ parentCandidateId: null, sourceJobId: j1.id });
    expect(two).toMatchObject({ parentCandidateId: one.id, sourceJobId: j2.id });
    expect(three).toMatchObject({ parentCandidateId: two.id, sourceJobId: j3.id, baseRevision: f.original.revision });
    expect(three.commands).toHaveLength(3);
    expect(three.commands[1]?.type).toBe("label.setOverrides");
    expect(three.previewDocument.labelStyle).toEqual(one.previewDocument.labelStyle);
    expect(three.previewDocument.labelStyle.sequence).toBe("lower-alpha");
    expect(three.previewDocument.panels[a]).toEqual(f.original.document.panels[a]);
    expect(three.previewDocument.panels[b]!.frameMm.x).toBeCloseTo(f.original.document.panels[b]!.frameMm.x + 1);
    expect(f.seen[2]!.selectedPanelIds).toEqual([b, c]);
    expect(hashFigureDocument(three.previewDocument)).toBe(three.resultDocumentHash);
    const before = (await f.app.inject({ method: "GET", url: f.project + "/document" })).json();
    expect(before.documentHash).toBe(f.original.documentHash);
    const accepted = await f.post(f.project + "/transactions", { baseRevision: f.original.revision, candidateId: three.id });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().document).toEqual(three.previewDocument);
    expect(accepted.json().revision).toBe(f.original.revision + 1);
    expect(f.seen).toHaveLength(3);
    const undone = await f.post(f.project + "/history/undo", { baseRevision: accepted.json().revision });
    expect(undone.json().documentHash).toBe(f.original.documentHash);
    const first = await f.history("?baseRevision=0&limit=1");
    const second = await f.history("?baseRevision=0&limit=1&cursor=" + first.nextCursor);
    expect(first.items[0]).toMatchObject({ jobId: j3.id, isStale: true, resolvedSelectedPanelIds: [b, c], result: { kind: "candidates", candidateIds: [three.id], summary: three.summary } });
    expect(second.items[0]?.jobId).toBe(j2.id);
    expect(JSON.stringify(first)).not.toMatch(/inputJson|rootHash|sourceHash|encryptedSecret|configRevision|commands|previewDocument/);
  });

  it("shows legacy candidate summaries and salvages damaged selections without changing stored history", async () => {
    const f = await setup(() => proposal({ type: "set_label_style", patch: { color: "#333333" } }));
    const legacy = await f.turn("legacy");
    const current = await f.turn("current");
    const stored = candidate(legacy);
    const { parentCandidateId: _parent, sourceJobId: _source, ...oldCandidate } = stored;
    const panel = f.original.document.panelOrder[0]!;
    const original = JSON.stringify({ configRevision: 2, request: { prompt: "legacy", baseRevision: 0,
      selectedPanelIds: [panel, panel, randomUUID(), "broken", false], replyLocale: "en-US", includePreviewImage: false, visualReview: false } });
    const db = new Database(path.join(f.dir, "panelstudio.sqlite"));
    try {
      db.prepare("UPDATE jobs SET inputJson=?,resultJson=? WHERE id=?").run(original,
        JSON.stringify({ kind: "candidates", candidates: [{ ...oldCandidate, summary: "Saved v0.1 summary" }] }), legacy.id);
      const page = await f.history();
      expect(page.items).toHaveLength(2);
      expect(page.items.find((item) => item.jobId === legacy.id)).toMatchObject({ resolvedSelectedPanelIds: [panel], isStale: true,
        result: { kind: "candidates", summary: "Saved v0.1 summary" } });
      expect(page.items.find((item) => item.jobId === current.id)).toMatchObject({ isStale: false, result: { summary: candidate(current).summary } });
      expect(db.prepare("SELECT inputJson FROM jobs WHERE id=?").get(legacy.id)).toEqual({ inputJson: original });
    } finally { db.close(); }
  });

  it("restores two questions, their options, original scope and originating draft", async () => {
    const f = await setup((scene, prompt) => {
      if (prompt === "first draft") return proposal({ type: "set_label_style", patch: { sequence: "lower-alpha" } });
      if (prompt === "arrange these") return { kind: "clarification", version: 1, question: "Which size?", options: ["Width", "Height"] };
      if (prompt === "Width") return { kind: "clarification", version: 1, question: "Which width?", options: ["20", "24"] };
      return proposal({ type: "scale_to_width", panelId: scene.selectedPanelIds[0]!, widthMm: 20 });
    });
    const first = candidate(await f.turn("first draft"));
    const panel = f.original.document.panelOrder[0]!;
    const q1 = await f.turn("arrange these", { context: { kind: "candidate", candidateId: first.id }, scope: "selection", selectedPanelIds: [panel] });
    const q2 = await f.turn("Width", { context: { kind: "clarification", jobId: q1.id } });
    const conflict = await f.enqueue("20", { scope: "document", context: { kind: "clarification", jobId: q2.id } });
    expect(conflict.json().error.code).toBe("AI_SCOPE_VIOLATION");
    const result = candidate(await f.turn("20", { context: { kind: "clarification", jobId: q2.id } }));
    expect(result.parentCandidateId).toBe(first.id);
    expect(result.previewDocument.panels[panel]!.frameMm.width).toBeCloseTo(20);
    expect(f.seen.at(-1)).toMatchObject({ scope: "selection", selectedPanelIds: [panel],
      previousTurns: [{ prompt: "first draft" }, { prompt: "arrange these", response: "Which size?", options: ["Width", "Height"] },
        { prompt: "Width", response: "Which width?", options: ["20", "24"] }] });
    const wrong = await f.enqueue("20", { context: { kind: "clarification", jobId: result.sourceJobId! } });
    expect(wrong.json().error.code).toBe("AI_CONTEXT_INVALID");
  });

  it("rejects empty or out-of-scope edits, version mismatches, and draft limits without a transaction", async () => {
    const f = await setup((scene, prompt) => prompt === "question" ? { version: 1, kind: "clarification", question: "What next?" }
      : prompt === "scope" ? proposal({ type: "set_label_style", patch: { sequence: "number" } })
      : prompt === "many" ? proposal(...Array.from({ length: 64 }, () => ({ type: "set_label_style" as const, patch: { color: "#333333" } })))
      : prompt === "wrong" ? proposal({ type: "set_panel_label", panelId: scene.panels[1]!.panelId, patch: { text: "E" } })
      : proposal({ type: "set_label_style", patch: { color: "#222222" } }));
    const empty = await f.enqueue("scope", { scope: "selection" });
    expect(empty.json().error.details.reason).toBe("empty-selection");
    for (const prompt of ["scope", "wrong"]) {
      const job = await f.turn(prompt, { scope: "selection", selectedPanelIds: [f.original.document.panelOrder[0]!] });
      expect(job.error?.code).toBe("AI_SCOPE_VIOLATION");
    }
    const one = candidate(await f.turn("one"));
    const many = await f.turn("many", { context: { kind: "candidate", candidateId: one.id } });
    expect(many.error).toMatchObject({ code: "AI_CHAIN_LIMIT", details: { reason: "command-limit" } });
    const db = new Database(path.join(f.dir, "panelstudio.sqlite"));
    try { db.prepare("UPDATE candidates SET fontRegistryVersion='old' WHERE id=?").run(one.id); } finally { db.close(); }
    expect((await f.enqueue("again", { context: { kind: "candidate", candidateId: one.id } })).json().error.code).toBe("CANDIDATE_STALE");
    expect((await f.post(f.project + "/transactions", { baseRevision: 0, candidateId: one.id })).json().error.code).toBe("CANDIDATE_STALE");
    let context: AIContext = { kind: "revision" };
    for (let i = 0; i < 10; i++) {
      const job = await f.turn("question", { context });
      expect(job.result).toMatchObject({ kind: "clarification" });
      context = { kind: "clarification", jobId: job.id };
    }
    expect((await f.enqueue("later", { context })).json().error).toMatchObject({ code: "AI_CHAIN_LIMIT", details: { reason: "turn-limit" } });
  });

  it("retains layout validation after refinement of an ordinary candidate", async () => {
    const f = await setup((scene, prompt) => prompt === "overlap"
      ? proposal({ type: "move_by_mm", targets: [{ kind: "panel", id: scene.panels[1]!.panelId }],
        dxMm: scene.panels[0]!.x - scene.panels[1]!.x, dyMm: scene.panels[0]!.y - scene.panels[1]!.y })
      : proposal({ type: "set_label_style", patch: { color: "#333333" } }));
    const layout = await f.post(f.project + "/layout-candidates", { baseRevision: 0, request: { family: "auto" }, maxCandidates: 1 });
    expect(layout.statusCode, layout.body).toBe(200);
    const parent: Candidate = layout.json().candidates[0];
    expect(parent).toMatchObject({ sourceJobId: null, parentCandidateId: null });
    const child = candidate(await f.turn("color", { context: { kind: "candidate", candidateId: parent.id } }));
    expect(child.validationMode).toBe("layout");
    const rejected = await f.turn("overlap", { context: { kind: "candidate", candidateId: child.id } });
    expect(rejected.error).toMatchObject({ code: "LAYOUT_CONFLICT", details: { reason: "layout-overlap" } });
  });

  it("keeps cancelled and deleted jobs from publishing candidates after an in-flight model reply", async () => {
    for (const kind of ["cancel", "delete"] as const) {
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const f = await setup(async () => { entered(); await waiting; return proposal({ type: "set_label_style", patch: { color: "#333333" } }); });
      const id = (await f.enqueue("wait")).json().jobId as string;
      const running = drainServerAiJobs(f.app);
      await started;
      if (kind === "cancel") await f.post(`/api/v1/jobs/${id}/cancel`, {});
      else await f.app.inject({ method: "DELETE", url: f.project });
      release();
      await running;
      expect((await f.readJob(id)).status).toBe("cancelled");
      const db = new Database(path.join(f.dir, "panelstudio.sqlite"), { readonly: true });
      try {
        expect(db.prepare("SELECT count(*) AS n FROM candidates WHERE sourceJobId=?").get(id)).toEqual({ n: 0 });
        expect(db.prepare("SELECT count(*) AS n FROM job_events WHERE jobId=? AND event='job.cancelled'").get(id)).toEqual({ n: 1 });
      } finally { db.close(); }
    }
  });

  it("expands grouped selections and protects the group and other panels on selected-only edits", async () => {
    const groupId = randomUUID();
    const f = await setup((scene, prompt) => {
      if (prompt === "move") return proposal({ type: "move_by_mm", targets: [{ kind: "group", id: groupId }], dxMm: 1, dyMm: 2 });
      if (prompt === "lock") return proposal({ type: "set_lock", targets: [{ kind: "group", id: groupId }], locked: true });
      return proposal({ type: "set_panel_label", panelId: scene.selectedPanelIds[0]!, patch: { text: "custom" } });
    });
    const [a, b, c] = f.original.document.panelOrder as [string, string, string];
    const grouped = await f.post(f.project + "/transactions", { baseRevision: 0, commands: [{ type: "group.create", groupId, name: "Unit", panelIds: [a, b] }] });
    expect(grouped.statusCode, grouped.body).toBe(200);
    const revision = grouped.json().revision;
    const one = candidate(await f.turn("move", { baseRevision: revision, scope: "selection", selectedPanelIds: [b] }));
    expect(f.seen.at(-1)?.selectedPanelIds).toEqual([a, b]);
    for (const id of [a, b]) {
      const frame = f.original.document.panels[id]!.frameMm;
      expect(one.previewDocument.panels[id]!.frameMm).toEqual({ ...frame, x: frame.x + 1, y: frame.y + 2 });
    }
    expect(one.previewDocument.panels[c]).toEqual(f.original.document.panels[c]);
    const two = candidate(await f.turn("lock", { baseRevision: revision, context: { kind: "candidate", candidateId: one.id } }));
    expect(two.previewDocument.groups[groupId]).toEqual({ name: "Unit", panelIds: [a, b], locked: true });
    const invalid = await f.turn("change member", { baseRevision: revision, context: { kind: "candidate", candidateId: two.id } });
    expect(invalid.error?.code).toBe("AI_SCOPE_VIOLATION");
  });

  it("starts a replacement request while the cancelled provider call is still unwinding", async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const f = await setup(async (_scene, prompt) => {
      if (prompt === "hold") { entered(); await waiting; }
      return proposal({ type: "set_label_style", patch: { color: "#666666" } });
    }, false);
    const old = (await f.enqueue("hold")).json().jobId as string;
    try {
      await started;
      await f.post(`/api/v1/jobs/${old}/cancel`, {});
      const next = (await f.enqueue("replacement")).json().jobId as string;
      const result = await waitForTerminalJob(f.app, next);
      expect(result.status).toBe("succeeded");
      expect((await f.readJob(old)).status).toBe("cancelled");
    } finally { release(); }
  });

  it("pages tied timestamps, refuses foreign context and keeps a late result read-only after a manual edit", async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const f = await setup(async (_scene, prompt) => {
      if (prompt === "wait") { entered(); await waiting; return proposal({ type: "set_label_style", patch: { color: "#333333" } }); }
      return { kind: "clarification", version: 1, question: "Which object?" };
    });
    const q = await f.turn("ask");
    const otherProject = (await f.post("/api/v1/projects", { title: "Other" })).json().project.id as string;
    const invalid = await f.post(`/api/v1/projects/${otherProject}/ai-layouts`, {
      baseRevision: 0, context: { kind: "clarification", jobId: q.id }, selectedPanelIds: [],
      prompt: "answer", replyLocale: "en-US", includePreviewImage: false, visualReview: false,
    });
    expect(invalid.json().error.code).toBe("AI_CONTEXT_INVALID");
    const id = (await f.enqueue("wait")).json().jobId as string;
    const running = drainServerAiJobs(f.app);
    await started;
    const edit = await f.post(f.project + "/transactions", { baseRevision: 0, commands: [{ type: "panel.rename", panelId: f.original.document.panelOrder[0]!, name: "Manual" }] });
    expect(edit.statusCode).toBe(200);
    release();
    await running;
    const late = candidate(await f.readJob(id));
    expect(late.previewDocument.panels[f.original.document.panelOrder[0]!]!.name).not.toBe("Manual");
    expect((await f.app.inject({ method: "GET", url: f.project + "/document" })).json().documentHash).toBe(edit.json().documentHash);
    expect((await f.post(f.project + "/transactions", { baseRevision: 0, candidateId: late.id })).statusCode).toBe(409);
    const db = new Database(path.join(f.dir, "panelstudio.sqlite"));
    try { db.prepare("UPDATE jobs SET createdAt='2026-01-01T00:00:00.000Z' WHERE kind='ai_layout'").run(); } finally { db.close(); }
    const p1 = await f.history("?limit=1");
    const p2 = await f.history("?limit=1&cursor=" + p1.nextCursor);
    expect([...p1.items, ...p2.items].map((t) => t.jobId)).toEqual([q.id, id].sort().reverse());
    expect(p2.nextCursor).toBeNull();
    expect([...p1.items, ...p2.items].every((t) => t.isStale)).toBe(true);
    expect((await f.app.inject({ method: "GET", url: f.project + "/ai-history?limit=0" })).statusCode).toBe(400);
    expect((await f.app.inject({ method: "GET", url: `/api/v1/projects/${otherProject}/ai-history?cursor=${p1.nextCursor}` })).statusCode).toBe(400);
  });

  it("labels the source and candidate images and distinguishes completed reviews from unavailable vision", async () => {
    const f = await setup(() => proposal({ type: "set_label_style", patch: { color: "#333333" } }));
    const withoutVision = candidate(await f.turn("make gray", { visualReview: true }));
    expect(withoutVision.diagnostics.some((d) => d.code === "AI_REVIEW_INCOMPLETE")).toBe(true);
    await f.config(true);
    const reviewed = candidate(await f.turn("make gray", { visualReview: true }));
    expect(reviewed.diagnostics.some((d) => d.code === "AI_REVIEW_COMPLETED")).toBe(true);
    const body = f.wire.at(-1) as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    const content = body.messages[1]!.content;
    expect(content.map((part) => part.type)).toEqual(["text", "image_url", "text", "image_url"]);
    expect(content[0]!.text).toContain("make gray");
    expect(content[0]!.text).toContain("Input draft before this turn");
    expect(content[2]!.text).toContain("Candidate after this turn");
  });
});
