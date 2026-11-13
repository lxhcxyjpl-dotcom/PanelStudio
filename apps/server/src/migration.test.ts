import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { JobSchema, createDefaultFigureDocument, type AIProviderConfig, type Candidate, type LayoutScore } from "@panelstudio/contracts";
import { hashFigureDocument } from "@panelstudio/core";
import { getAsset, getCandidate, getJob, getProject, getRevision, insertAsset, insertJob, insertProject,
  insertRevision, openDatabase, publicJob, readProvider, writeProviderConfig } from "./db.js";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "ps-migrate-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Freeze the version-zero shape before adding rows. The v0.1 app used unversioned WAL.
function v01(dir: string) {
  const db = new Database(path.join(dir, "panelstudio.sqlite"));
  db.pragma("journal_mode=WAL");
  db.pragma("wal_autocheckpoint=0");
  db.exec(readFileSync(new URL("../../../fixtures/database/v0.1.sql", import.meta.url), "utf8"));
  return db;
}

describe("SQLite v0.1 migration", () => {
  it("backs up committed WAL pages, preserves old rows and returns provenance on legacy job results", () => {
    const dir = tempDir();
    const legacy = v01(dir);
    const projectId = randomUUID(), assetId = randomUUID(), candidateId = randomUUID(), jobId = randomUUID();
    const now = "2026-08-10T00:00:00.000Z";
    const document = createDefaultFigureDocument();
    const documentHash = hashFigureDocument(document);
    const project = { id: projectId, title: "Legacy example", createdAt: now, updatedAt: now, deletedAt: null,
      currentRevision: 1, undoStack: [0], redoStack: [] };
    const provider: AIProviderConfig = { adapter: "openai-compatible", model: "migration-fixture", baseUrl: "http://127.0.0.1:1/v1",
      capabilities: { imageInput: false, structuredOutput: "json_object" }, allowLocalEndpoint: true };
    const score: LayoutScore = { scoringVersion: "0.1.0", penalties: { readability: "unknown", whitespace: "unknown", emphasis: "unknown",
      consistency: "unknown", height: "unknown", movement: "unknown" }, total: null };
    const legacyCandidate: Omit<Candidate, "parentCandidateId" | "sourceJobId"> = { id: candidateId, projectId, baseRevision: 0, origin: "ai",
      validationMode: "edit", summary: "Saved draft", commands: [], previewDocument: document, resultDocumentHash: documentHash,
      diagnostics: [], engineVersion: "0.1.0", fontRegistryVersion: "1" };
    let migrated: Database.Database | undefined;
    let backup: Database.Database | undefined;
    let fresh: Database.Database | undefined;
    try {
      insertProject(legacy, project, { document, documentHash, kind: "create", engineVersion: "0.1.0", createdAt: now });
      insertRevision(legacy, { projectId, revision: 1, baseRevision: 0, kind: "transaction", document, documentHash,
        commandsJson: [], transactionId: randomUUID(), targetRevision: null, engineVersion: "0.1.0", createdAt: now });
      insertAsset(legacy, { id: assetId, projectId, createdAt: now, originalFilename: "legacy.svg", originalMediaType: "image/svg+xml",
        originalByteLength: 30, originalSha256: "f".repeat(64), status: "failed", importJobId: randomUUID(), diagnostics: [],
        normalized: null, removedFromLibraryAt: null, originalBlobPath: "blobs/aa/test", renderBlobPath: null, thumbnailBlobPath: null });
      writeProviderConfig(legacy, provider, "opaque-test-ciphertext", now);
      legacy.prepare("INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(candidateId, projectId, 0,
        "ai", "edit", "[]", documentHash, "Saved draft", "[]", JSON.stringify(score), "0.1.0", "1", now);
      insertJob(legacy, { id: jobId, projectId, kind: "ai_layout", status: "succeeded", phase: "ready", createdAt: now,
        startedAt: now, finishedAt: now, result: null, error: null, inputJson: {
          request: { baseRevision: 0, prompt: "legacy", selectedPanelIds: [], replyLocale: "en-US", includePreviewImage: false, visualReview: false } } });
      const oldResult = JSON.stringify({ kind: "candidates", candidates: [legacyCandidate] });
      legacy.prepare("UPDATE jobs SET resultJson = ? WHERE id = ?").run(oldResult, jobId);
      migrated = openDatabase(dir);
      expect(migrated.pragma("user_version", { simple: true })).toBe(4);
      expect(getProject(migrated, projectId)).toEqual(project);
      expect(getRevision(migrated, projectId, 1)?.documentHash).toBe(documentHash);
      expect(getAsset(migrated, projectId, assetId)?.originalFilename).toBe("legacy.svg");
      expect(readProvider(migrated)).toEqual({ config: provider, configRevision: 1, encryptedSecret: "opaque-test-ciphertext", updatedAt: now });
      expect(getCandidate(migrated, candidateId)).toMatchObject({ parentCandidateId: null, sourceJobId: null, id: candidateId });
      const job = publicJob(getJob(migrated, jobId)!);
      expect(Check(JobSchema, job)).toBe(true);
      expect(job.result).toMatchObject({ candidates: [{ parentCandidateId: null, sourceJobId: null }] });
      expect(migrated.prepare("SELECT resultJson FROM jobs WHERE id=?").get(jobId)).toEqual({ resultJson: oldResult });
      const backups = readdirSync(path.join(dir, "backups"));
      expect(backups).toHaveLength(1);
      backup = new Database(path.join(dir, "backups", backups[0]!), { readonly: true });
      expect(backup.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(backup.pragma("user_version", { simple: true })).toBe(0);
      expect(getRevision(backup, projectId, 1)?.documentHash).toBe(documentHash);
      expect(migrated.prepare("SELECT * FROM assets").all()).toEqual(backup.prepare("SELECT * FROM assets").all());
      expect(readProvider(backup)).toEqual(readProvider(migrated));
      fresh = openDatabase(tempDir());
      const definitions = (db: Database.Database) => db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();
      expect(definitions(migrated)).toEqual(definitions(fresh));
      openDatabase(dir).close();
      expect(readdirSync(path.join(dir, "backups"))).toEqual(backups);
    } finally { backup?.close(); migrated?.close(); fresh?.close(); legacy.close(); }
  });

  it("upgrades numbered version 2 and allows different project assets to share a UUID", () => {
    const dir = tempDir();
    const old = v01(dir);
    old.exec(`ALTER TABLE candidates ADD COLUMN parentCandidateId TEXT;
      ALTER TABLE candidates ADD COLUMN sourceJobId TEXT;
      CREATE INDEX ai_history_project ON jobs(projectId,createdAt DESC,id DESC) WHERE kind='ai_layout';
      CREATE INDEX ai_history_revision ON jobs(projectId,json_extract(inputJson,'$.request.baseRevision'),createdAt DESC,id DESC) WHERE kind='ai_layout';
      PRAGMA user_version=2;`);
    const assetId = randomUUID(), projectId = randomUUID(), other = randomUUID();
    const now = "2026-08-10T00:00:00.000Z";
    const asset = { id: assetId, projectId, createdAt: now, originalFilename: "from-v2.svg", originalMediaType: "image/svg+xml" as const,
      originalByteLength: 32, originalSha256: "d".repeat(64), status: "failed" as const, importJobId: randomUUID(), diagnostics: [],
      normalized: null, removedFromLibraryAt: now, originalBlobPath: "blobs/dd/fixture", renderBlobPath: null, thumbnailBlobPath: null };
    const document = createDefaultFigureDocument();
    let migrated: Database.Database | undefined;
    try {
      for (const id of [projectId, other]) {
        insertProject(old, { id, title: "Versioned", createdAt: now, updatedAt: now, deletedAt: null,
          currentRevision: 0, undoStack: [], redoStack: [] }, { document, documentHash: hashFigureDocument(document), kind: "create", engineVersion: "0.1.0", createdAt: now });
      }
      insertAsset(old, asset);
      migrated = openDatabase(dir);
      expect(getAsset(migrated, projectId, assetId)).toEqual(asset);
      insertAsset(migrated, { ...asset, projectId: other, originalFilename: "other.svg", removedFromLibraryAt: null });
      expect(getAsset(migrated, other, assetId)).toMatchObject({ originalFilename: "other.svg", removedFromLibraryAt: null });
      expect(getAsset(migrated, projectId, assetId)).toEqual(asset);
      expect(migrated.pragma("foreign_key_check")).toEqual([]);
      const backup = new Database(path.join(dir, "backups", readdirSync(path.join(dir, "backups"))[0]!), { readonly: true });
      try { expect(backup.pragma("user_version", { simple: true })).toBe(2); } finally { backup.close(); }
    } finally { migrated?.close(); old.close(); }
  });

  it("adds layout choices to a version 3 database without rebuilding project assets", () => {
    const dir = tempDir();
    const old = openDatabase(dir);
    old.exec("DROP TABLE layout_choices; PRAGMA user_version=3;");
    const definition = old.prepare("SELECT sql FROM sqlite_schema WHERE name='assets'").get();
    old.close();
    const upgraded = openDatabase(dir);
    try {
      expect(upgraded.pragma("user_version", { simple: true })).toBe(4);
      expect(upgraded.prepare("SELECT sql FROM sqlite_schema WHERE name='assets'").get()).toEqual(definition);
      expect(upgraded.prepare("SELECT * FROM layout_choices").all()).toEqual([]);
      expect(readdirSync(path.join(dir, "backups"))).toHaveLength(1);
    } finally { upgraded.close(); }
  });

  it("rolls back every migration statement and rejects unknown newer versions", () => {
    const dir = tempDir();
    const failed = v01(dir);
    try {
      failed.exec("CREATE INDEX ai_history_project ON jobs(phase)");
      expect(() => openDatabase(dir)).toThrow();
      expect(failed.pragma("user_version", { simple: true })).toBe(0);
      const columns = failed.pragma("table_info(candidates)") as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "parentCandidateId")).toBe(false);
      failed.pragma("user_version=99");
      expect(() => openDatabase(dir)).toThrow(/newer than supported/);
      expect(failed.pragma("user_version", { simple: true })).toBe(99);
      expect(readdirSync(path.join(dir, "backups"))).toHaveLength(1);
    } finally { failed.close(); }
  });

  it("restores the old assets table if a row cannot be copied to the new primary key", () => {
    const dir = tempDir();
    const legacy = v01(dir);
    try {
      const id = randomUUID(), now = "2026-08-10T00:00:00.000Z", document = createDefaultFigureDocument();
      insertProject(legacy, { id, title: "Rollback fixture", createdAt: now, updatedAt: now, deletedAt: null,
        currentRevision: 0, undoStack: [], redoStack: [] }, { document, documentHash: hashFigureDocument(document), kind: "create", engineVersion: "0.1.0", createdAt: now });
      // SQLite permits NULL in the legacy non-integer PRIMARY KEY. A corrupt row must stop the upgrade.
      legacy.prepare(`INSERT INTO assets (id,projectId,createdAt,originalFilename,originalMediaType,originalByteLength,
        originalSha256,status,importJobId,diagnosticsJson,originalBlobPath) VALUES(NULL,?,?,'legacy.png','image/png',1,'bad','failed',?,'[]','old')`)
        .run(id, now, randomUUID());
      expect(() => openDatabase(dir)).toThrow(/NOT NULL/);
      expect(legacy.pragma("user_version", { simple: true })).toBe(0);
      expect(legacy.prepare("SELECT id,originalFilename FROM assets").all()).toEqual([{ id: null, originalFilename: "legacy.png" }]);
      expect(legacy.prepare("SELECT name FROM sqlite_schema WHERE name='assets_with_global_ids'").all()).toEqual([]);
      const names = (legacy.pragma("table_info(candidates)") as Array<{ name: string }>).map((column) => column.name);
      expect(names).not.toContain("sourceJobId");
    } finally { legacy.close(); }
  });
});
