import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AIProviderConfig,
  Asset,
  Diagnostic,
  DomainCommand,
  FigureDocumentV1,
  Job,
  LayoutScore,
  NormalizedAsset,
} from "@panelstudio/contracts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  currentRevision INTEGER NOT NULL,
  undoStackJson TEXT NOT NULL,
  redoStackJson TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_revisions (
  projectId TEXT NOT NULL,
  revision INTEGER NOT NULL,
  baseRevision INTEGER,
  kind TEXT NOT NULL,
  documentJson TEXT NOT NULL,
  documentHash TEXT NOT NULL,
  commandsJson TEXT NOT NULL,
  transactionId TEXT,
  targetRevision INTEGER,
  engineVersion TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (projectId, revision),
  FOREIGN KEY (projectId) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  originalFilename TEXT NOT NULL,
  originalMediaType TEXT NOT NULL,
  originalByteLength INTEGER NOT NULL,
  originalSha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  importJobId TEXT NOT NULL,
  normalizedJson TEXT,
  diagnosticsJson TEXT NOT NULL,
  removedFromLibraryAt TEXT,
  originalBlobPath TEXT NOT NULL,
  renderBlobPath TEXT,
  thumbnailBlobPath TEXT,
  FOREIGN KEY (projectId) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  inputJson TEXT NOT NULL,
  resultJson TEXT,
  errorJson TEXT,
  cancelRequested INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  startedAt TEXT,
  finishedAt TEXT
);
CREATE TABLE IF NOT EXISTS job_events (
  jobId TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (jobId, seq)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  revision INTEGER,
  candidateId TEXT,
  kind TEXT NOT NULL,
  mediaType TEXT NOT NULL,
  filename TEXT NOT NULL,
  byteLength INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  blobPath TEXT NOT NULL,
  rendererVersion TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (projectId) REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  baseRevision INTEGER NOT NULL,
  origin TEXT NOT NULL,
  validationMode TEXT NOT NULL,
  commandsJson TEXT NOT NULL,
  resultDocumentHash TEXT NOT NULL,
  summary TEXT NOT NULL,
  diagnosticsJson TEXT NOT NULL,
  scoreJson TEXT NOT NULL,
  engineVersion TEXT NOT NULL,
  fontRegistryVersion TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  requestHash TEXT NOT NULL,
  httpStatus INTEGER NOT NULL,
  responseJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS provider_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  configRevision INTEGER NOT NULL,
  configJson TEXT NOT NULL,
  encryptedSecret TEXT,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_project ON assets(projectId);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(projectId);
`;

export type ProjectRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  currentRevision: number;
  undoStack: number[];
  redoStack: number[];
};

export type AssetRecord = Asset & {
  originalBlobPath: string;
  renderBlobPath: string | null;
  thumbnailBlobPath: string | null;
};

export type RevisionRecord = {
  projectId: string;
  revision: number;
  baseRevision: number | null;
  kind: string;
  document: FigureDocumentV1;
  documentHash: string;
  commandsJson: unknown;
  transactionId: string | null;
  targetRevision: number | null;
  engineVersion: string;
  createdAt: string;
};

export type JobRecord = {
  id: string;
  projectId: string | null;
  kind: Job["kind"];
  status: Job["status"];
  phase: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Job["result"];
  error: Job["error"];
};

export type ArtifactRecord = {
  id: string;
  projectId: string;
  revision: number | null;
  candidateId: string | null;
  kind: string;
  mediaType: string;
  filename: string;
  byteLength: number;
  sha256: string;
  blobPath: string;
  rendererVersion: string;
  createdAt: string;
};

export type IdempotencyRecord = {
  requestHash: string;
  httpStatus: number;
  responseJson: string;
};

export type CandidateRecord = {
  id: string;
  projectId: string;
  baseRevision: number;
  origin: "layout" | "ai";
  validationMode: "edit" | "layout";
  commands: DomainCommand[];
  resultDocumentHash: string;
  summary: string;
  diagnostics: Diagnostic[];
  score: LayoutScore;
  engineVersion: string;
  fontRegistryVersion: string;
  createdAt: string;
};

type ProjectRow = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  currentRevision: number;
  undoStackJson: string;
  redoStackJson: string;
};

type AssetRow = {
  id: string;
  projectId: string;
  createdAt: string;
  originalFilename: string;
  originalMediaType: Asset["originalMediaType"];
  originalByteLength: number;
  originalSha256: string;
  status: Asset["status"];
  importJobId: string;
  normalizedJson: string | null;
  diagnosticsJson: string;
  removedFromLibraryAt: string | null;
  originalBlobPath: string;
  renderBlobPath: string | null;
  thumbnailBlobPath: string | null;
};

export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "panelstudio.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function immediate<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}

export function insertProject(
  db: Database.Database,
  project: ProjectRecord,
  revision: {
    document: FigureDocumentV1;
    documentHash: string;
    kind: string;
    engineVersion: string;
    createdAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO projects (id, title, createdAt, updatedAt, deletedAt, currentRevision, undoStackJson, redoStackJson)
     VALUES (@id, @title, @createdAt, @updatedAt, @deletedAt, @currentRevision, @undoStackJson, @redoStackJson)`,
  ).run({
    ...project,
    undoStackJson: JSON.stringify(project.undoStack),
    redoStackJson: JSON.stringify(project.redoStack),
  });
  insertRevision(db, {
    projectId: project.id,
    revision: 0,
    baseRevision: null,
    kind: revision.kind,
    document: revision.document,
    documentHash: revision.documentHash,
    commandsJson: [],
    transactionId: null,
    targetRevision: null,
    engineVersion: revision.engineVersion,
    createdAt: revision.createdAt,
  });
}

export function getProject(db: Database.Database, id: string): ProjectRecord | null {
  const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    currentRevision: row.currentRevision,
    undoStack: JSON.parse(row.undoStackJson) as number[],
    redoStack: JSON.parse(row.redoStackJson) as number[],
  };
}

export function updateProjectHead(
  db: Database.Database,
  project: Pick<ProjectRecord, "id" | "currentRevision" | "updatedAt" | "undoStack" | "redoStack">,
): void {
  db.prepare(
    `UPDATE projects
     SET currentRevision = @currentRevision, updatedAt = @updatedAt, undoStackJson = @undoStackJson, redoStackJson = @redoStackJson
     WHERE id = @id`,
  ).run({
    id: project.id,
    currentRevision: project.currentRevision,
    updatedAt: project.updatedAt,
    undoStackJson: JSON.stringify(project.undoStack),
    redoStackJson: JSON.stringify(project.redoStack),
  });
}

export function touchProject(db: Database.Database, id: string, updatedAt: string): void {
  db.prepare(`UPDATE projects SET updatedAt = ? WHERE id = ?`).run(updatedAt, id);
}

/** Title only. Renames are not canvas history and do not change the revision. */
export function renameProject(db: Database.Database, id: string, title: string, updatedAt: string): void {
  db.prepare(`UPDATE projects SET title = ?, updatedAt = ? WHERE id = ?`).run(title, updatedAt, id);
}

/** Keeps the bytes. Historical revisions can still read a removed library asset. */
export function markAssetRemoved(db: Database.Database, id: string, removedAt: string): void {
  db.prepare(`UPDATE assets SET removedFromLibraryAt = ? WHERE id = ?`).run(removedAt, id);
}

export function insertRevision(db: Database.Database, revision: RevisionRecord): void {
  db.prepare(
    `INSERT INTO project_revisions
      (projectId, revision, baseRevision, kind, documentJson, documentHash, commandsJson, transactionId, targetRevision, engineVersion, createdAt)
     VALUES
      (@projectId, @revision, @baseRevision, @kind, @documentJson, @documentHash, @commandsJson, @transactionId, @targetRevision, @engineVersion, @createdAt)`,
  ).run({
    projectId: revision.projectId,
    revision: revision.revision,
    baseRevision: revision.baseRevision,
    kind: revision.kind,
    documentJson: JSON.stringify(revision.document),
    documentHash: revision.documentHash,
    commandsJson: JSON.stringify(revision.commandsJson),
    transactionId: revision.transactionId,
    targetRevision: revision.targetRevision,
    engineVersion: revision.engineVersion,
    createdAt: revision.createdAt,
  });
}

export function getRevision(
  db: Database.Database,
  projectId: string,
  revision: number,
): RevisionRecord | null {
  const row = db
    .prepare(`SELECT * FROM project_revisions WHERE projectId = ? AND revision = ?`)
    .get(projectId, revision) as
    | {
        projectId: string;
        revision: number;
        baseRevision: number | null;
        kind: string;
        documentJson: string;
        documentHash: string;
        commandsJson: string;
        transactionId: string | null;
        targetRevision: number | null;
        engineVersion: string;
        createdAt: string;
      }
    | undefined;
  if (!row) return null;
  return {
    projectId: row.projectId,
    revision: row.revision,
    baseRevision: row.baseRevision,
    kind: row.kind,
    document: JSON.parse(row.documentJson) as FigureDocumentV1,
    documentHash: row.documentHash,
    commandsJson: JSON.parse(row.commandsJson) as unknown,
    transactionId: row.transactionId,
    targetRevision: row.targetRevision,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt,
  };
}

export function insertAsset(db: Database.Database, asset: AssetRecord): void {
  db.prepare(
    `INSERT INTO assets (
      id, projectId, createdAt, originalFilename, originalMediaType, originalByteLength, originalSha256,
      status, importJobId, normalizedJson, diagnosticsJson, removedFromLibraryAt,
      originalBlobPath, renderBlobPath, thumbnailBlobPath
    ) VALUES (
      @id, @projectId, @createdAt, @originalFilename, @originalMediaType, @originalByteLength, @originalSha256,
      @status, @importJobId, @normalizedJson, @diagnosticsJson, @removedFromLibraryAt,
      @originalBlobPath, @renderBlobPath, @thumbnailBlobPath
    )`,
  ).run({
    id: asset.id,
    projectId: asset.projectId,
    createdAt: asset.createdAt,
    originalFilename: asset.originalFilename,
    originalMediaType: asset.originalMediaType,
    originalByteLength: asset.originalByteLength,
    originalSha256: asset.originalSha256,
    status: asset.status,
    importJobId: asset.importJobId,
    normalizedJson: asset.normalized ? JSON.stringify(asset.normalized) : null,
    diagnosticsJson: JSON.stringify(asset.diagnostics),
    removedFromLibraryAt: asset.removedFromLibraryAt,
    originalBlobPath: asset.originalBlobPath,
    renderBlobPath: asset.renderBlobPath,
    thumbnailBlobPath: asset.thumbnailBlobPath,
  });
}

export function getAsset(db: Database.Database, id: string): AssetRecord | null {
  const row = db.prepare(`SELECT * FROM assets WHERE id = ?`).get(id) as AssetRow | undefined;
  return row ? mapAsset(row) : null;
}

export function listAssets(db: Database.Database, projectId: string): AssetRecord[] {
  const rows = db
    .prepare(`SELECT * FROM assets WHERE projectId = ? ORDER BY createdAt ASC, id ASC`)
    .all(projectId) as AssetRow[];
  return rows.map(mapAsset);
}

export function countAssets(db: Database.Database, projectId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM assets WHERE projectId = ? AND removedFromLibraryAt IS NULL`,
    )
    .get(projectId) as { count: number };
  return row.count;
}

export function sumOriginalBytes(db: Database.Database, projectId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(originalByteLength), 0) AS total FROM assets WHERE projectId = ? AND removedFromLibraryAt IS NULL`,
    )
    .get(projectId) as { total: number };
  return row.total;
}

export function insertJob(
  db: Database.Database,
  job: JobRecord & { inputJson: unknown; cancelRequested?: boolean },
): void {
  db.prepare(
    `INSERT INTO jobs (
      id, projectId, kind, status, phase, inputJson, resultJson, errorJson, cancelRequested, createdAt, startedAt, finishedAt
    ) VALUES (
      @id, @projectId, @kind, @status, @phase, @inputJson, @resultJson, @errorJson, @cancelRequested, @createdAt, @startedAt, @finishedAt
    )`,
  ).run({
    id: job.id,
    projectId: job.projectId,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    inputJson: JSON.stringify(job.inputJson),
    resultJson: job.result ? JSON.stringify(job.result) : null,
    errorJson: job.error ? JSON.stringify(job.error) : null,
    cancelRequested: job.cancelRequested ? 1 : 0,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
}

export function updateJobProject(db: Database.Database, id: string, projectId: string): void {
  db.prepare(`UPDATE jobs SET projectId = ? WHERE id = ?`).run(projectId, id);
}

export function getJob(db: Database.Database, id: string): JobRecord | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
    | {
        id: string;
        projectId: string | null;
        kind: Job["kind"];
        status: Job["status"];
        phase: string;
        resultJson: string | null;
        errorJson: string | null;
        createdAt: string;
        startedAt: string | null;
        finishedAt: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    result: row.resultJson ? (JSON.parse(row.resultJson) as Job["result"]) : null,
    error: row.errorJson ? (JSON.parse(row.errorJson) as Job["error"]) : null,
  };
}

export function insertJobEvent(
  db: Database.Database,
  event: { jobId: string; seq: number; event: string; payloadJson: unknown; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO job_events (jobId, seq, event, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?)`,
  ).run(event.jobId, event.seq, event.event, JSON.stringify(event.payloadJson), event.createdAt);
}

export function insertArtifact(db: Database.Database, artifact: ArtifactRecord): void {
  db.prepare(
    `INSERT INTO artifacts (
      id, projectId, revision, candidateId, kind, mediaType, filename, byteLength, sha256, blobPath, rendererVersion, createdAt
    ) VALUES (
      @id, @projectId, @revision, @candidateId, @kind, @mediaType, @filename, @byteLength, @sha256, @blobPath, @rendererVersion, @createdAt
    )`,
  ).run(artifact);
}

export function getArtifact(db: Database.Database, id: string): ArtifactRecord | null {
  const row = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id) as ArtifactRecord | undefined;
  return row ?? null;
}

export function insertCandidate(db: Database.Database, candidate: CandidateRecord): void {
  db.prepare(
    `INSERT INTO candidates (
      id, projectId, baseRevision, origin, validationMode, commandsJson, resultDocumentHash,
      summary, diagnosticsJson, scoreJson, engineVersion, fontRegistryVersion, createdAt
    ) VALUES (
      @id, @projectId, @baseRevision, @origin, @validationMode, @commandsJson, @resultDocumentHash,
      @summary, @diagnosticsJson, @scoreJson, @engineVersion, @fontRegistryVersion, @createdAt
    )
    ON CONFLICT(id) DO NOTHING`,
  ).run({
    id: candidate.id,
    projectId: candidate.projectId,
    baseRevision: candidate.baseRevision,
    origin: candidate.origin,
    validationMode: candidate.validationMode,
    commandsJson: JSON.stringify(candidate.commands),
    resultDocumentHash: candidate.resultDocumentHash,
    summary: candidate.summary,
    diagnosticsJson: JSON.stringify(candidate.diagnostics),
    scoreJson: JSON.stringify(candidate.score),
    engineVersion: candidate.engineVersion,
    fontRegistryVersion: candidate.fontRegistryVersion,
    createdAt: candidate.createdAt,
  });
}

export function getCandidate(db: Database.Database, id: string): CandidateRecord | null {
  const row = db.prepare(`SELECT * FROM candidates WHERE id = ?`).get(id) as
    | {
        id: string;
        projectId: string;
        baseRevision: number;
        origin: "layout" | "ai";
        validationMode: "edit" | "layout";
        commandsJson: string;
        resultDocumentHash: string;
        summary: string;
        diagnosticsJson: string;
        scoreJson: string;
        engineVersion: string;
        fontRegistryVersion: string;
        createdAt: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    baseRevision: row.baseRevision,
    origin: row.origin,
    validationMode: row.validationMode,
    commands: JSON.parse(row.commandsJson) as DomainCommand[],
    resultDocumentHash: row.resultDocumentHash,
    summary: row.summary,
    diagnostics: JSON.parse(row.diagnosticsJson) as Diagnostic[],
    score: JSON.parse(row.scoreJson) as LayoutScore,
    engineVersion: row.engineVersion,
    fontRegistryVersion: row.fontRegistryVersion,
    createdAt: row.createdAt,
  };
}

export function getIdempotency(
  db: Database.Database,
  scope: string,
  key: string,
): IdempotencyRecord | null {
  const row = db
    .prepare(`SELECT requestHash, httpStatus, responseJson FROM idempotency_records WHERE scope = ? AND key = ?`)
    .get(scope, key) as IdempotencyRecord | undefined;
  return row ?? null;
}

export function insertIdempotency(
  db: Database.Database,
  record: IdempotencyRecord & { scope: string; key: string; createdAt: string },
): void {
  db.prepare(
    `INSERT INTO idempotency_records (scope, key, requestHash, httpStatus, responseJson, createdAt)
     VALUES (@scope, @key, @requestHash, @httpStatus, @responseJson, @createdAt)`,
  ).run(record);
}

function mapAsset(row: AssetRow): AssetRecord {
  const normalized = row.normalizedJson ? (JSON.parse(row.normalizedJson) as NormalizedAsset) : null;
  const diagnostics = JSON.parse(row.diagnosticsJson) as Diagnostic[];
  const shared = {
    id: row.id,
    projectId: row.projectId,
    createdAt: row.createdAt,
    originalFilename: row.originalFilename,
    originalMediaType: row.originalMediaType,
    originalByteLength: row.originalByteLength,
    originalSha256: row.originalSha256,
    importJobId: row.importJobId,
    diagnostics,
    removedFromLibraryAt: row.removedFromLibraryAt,
    originalBlobPath: row.originalBlobPath,
    renderBlobPath: row.renderBlobPath,
    thumbnailBlobPath: row.thumbnailBlobPath,
  };
  if (row.status === "ready" && normalized) {
    return { ...shared, status: "ready", normalized };
  }
  if (row.status === "failed" || (row.status === "ready" && !normalized)) {
    return { ...shared, status: "failed", normalized: null };
  }
  return { ...shared, status: "processing", normalized: null };
}

export function publicAsset(asset: AssetRecord): Asset {
  if (asset.status === "ready") {
    return {
      id: asset.id,
      projectId: asset.projectId,
      createdAt: asset.createdAt,
      originalFilename: asset.originalFilename,
      originalMediaType: asset.originalMediaType,
      originalByteLength: asset.originalByteLength,
      originalSha256: asset.originalSha256,
      status: "ready",
      importJobId: asset.importJobId,
      normalized: asset.normalized,
      diagnostics: asset.diagnostics,
      removedFromLibraryAt: asset.removedFromLibraryAt,
    };
  }
  return {
    id: asset.id,
    projectId: asset.projectId,
    createdAt: asset.createdAt,
    originalFilename: asset.originalFilename,
    originalMediaType: asset.originalMediaType,
    originalByteLength: asset.originalByteLength,
    originalSha256: asset.originalSha256,
    status: asset.status,
    importJobId: asset.importJobId,
    normalized: null,
    diagnostics: asset.diagnostics,
    removedFromLibraryAt: asset.removedFromLibraryAt,
  };
}

export type JobDetail = JobRecord & {
  input: unknown;
  cancelRequested: boolean;
};

export type ProviderRecord = {
  configRevision: number;
  config: AIProviderConfig;
  encryptedSecret: string | null;
  updatedAt: string;
};

type JobRow = {
  id: string;
  projectId: string | null;
  kind: Job["kind"];
  status: Job["status"];
  phase: string;
  inputJson: string;
  resultJson: string | null;
  errorJson: string | null;
  cancelRequested: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

function mapJob(row: JobRow): JobDetail {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    phase: row.phase,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    result: row.resultJson ? (JSON.parse(row.resultJson) as Job["result"]) : null,
    error: row.errorJson ? (JSON.parse(row.errorJson) as Job["error"]) : null,
    input: JSON.parse(row.inputJson) as unknown,
    cancelRequested: row.cancelRequested === 1,
  };
}

export function getJobDetail(db: Database.Database, id: string): JobDetail | null {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function listActiveAiJobs(db: Database.Database): JobDetail[] {
  const rows = db
    .prepare(
      `SELECT * FROM jobs WHERE kind IN ('ai_layout', 'provider_test') AND status IN ('queued', 'running') ORDER BY createdAt`,
    )
    .all() as JobRow[];
  return rows.map(mapJob);
}

export function listQueuedAiJobs(db: Database.Database): JobDetail[] {
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE kind IN ('ai_layout', 'provider_test') AND status = 'queued' ORDER BY createdAt`)
    .all() as JobRow[];
  return rows.map(mapJob);
}

export function updateJobState(
  db: Database.Database,
  id: string,
  patch: {
    status: Job["status"];
    phase: string;
    result: Job["result"];
    error: Job["error"];
    startedAt: string | null;
    finishedAt: string | null;
    cancelRequested?: boolean;
  },
): void {
  db.prepare(
    `UPDATE jobs SET status = @status, phase = @phase, resultJson = @resultJson, errorJson = @errorJson,
      startedAt = @startedAt, finishedAt = @finishedAt, cancelRequested = COALESCE(@cancelRequested, cancelRequested)
     WHERE id = @id`,
  ).run({
    id,
    status: patch.status,
    phase: patch.phase,
    resultJson: patch.result ? JSON.stringify(patch.result) : null,
    errorJson: patch.error ? JSON.stringify(patch.error) : null,
    startedAt: patch.startedAt,
    finishedAt: patch.finishedAt,
    cancelRequested: patch.cancelRequested === undefined ? null : patch.cancelRequested ? 1 : 0,
  });
}

export function markCancelRequested(db: Database.Database, id: string): void {
  db.prepare(`UPDATE jobs SET cancelRequested = 1 WHERE id = ?`).run(id);
}

export function appendJobEvent(
  db: Database.Database,
  event: { jobId: string; event: string; payloadJson: unknown; createdAt: string },
): number {
  const row = db.prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM job_events WHERE jobId = ?`).get(event.jobId) as {
    seq: number;
  };
  db.prepare(`INSERT INTO job_events (jobId, seq, event, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?)`).run(
    event.jobId,
    row.seq,
    event.event,
    JSON.stringify(event.payloadJson),
    event.createdAt,
  );
  return row.seq;
}

export function listJobEvents(
  db: Database.Database,
  jobId: string,
  afterSeq: number,
): Array<{ seq: number; event: string; payloadJson: unknown; createdAt: string }> {
  const rows = db
    .prepare(`SELECT seq, event, payloadJson, createdAt FROM job_events WHERE jobId = ? AND seq > ? ORDER BY seq`)
    .all(jobId, afterSeq) as Array<{ seq: number; event: string; payloadJson: string; createdAt: string }>;
  return rows.map((row) => ({ ...row, payloadJson: JSON.parse(row.payloadJson) as unknown }));
}

export function readProvider(db: Database.Database): ProviderRecord | null {
  const row = db
    .prepare(`SELECT configRevision, configJson, encryptedSecret, updatedAt FROM provider_settings WHERE singleton = 1`)
    .get() as
    | { configRevision: number; configJson: string; encryptedSecret: string | null; updatedAt: string }
    | undefined;
  if (!row) return null;
  return {
    configRevision: row.configRevision,
    config: JSON.parse(row.configJson) as AIProviderConfig,
    encryptedSecret: row.encryptedSecret,
    updatedAt: row.updatedAt,
  };
}

export function writeProviderConfig(
  db: Database.Database,
  config: AIProviderConfig,
  encryptedSecret: string | null,
  now: string,
): ProviderRecord {
  const current = readProvider(db);
  const configRevision = (current?.configRevision ?? 0) + 1;
  const secret = encryptedSecret === undefined ? current?.encryptedSecret ?? null : encryptedSecret;
  db.prepare(
    `INSERT INTO provider_settings (singleton, configRevision, configJson, encryptedSecret, updatedAt)
     VALUES (1, @configRevision, @configJson, @encryptedSecret, @updatedAt)
     ON CONFLICT(singleton) DO UPDATE SET
       configRevision = excluded.configRevision,
       configJson = excluded.configJson,
       encryptedSecret = excluded.encryptedSecret,
       updatedAt = excluded.updatedAt`,
  ).run({
    configRevision,
    configJson: JSON.stringify(config),
    encryptedSecret: secret,
    updatedAt: now,
  });
  return { configRevision, config, encryptedSecret: secret, updatedAt: now };
}

export function publicJob(job: JobRecord): Job {
  const shared = {
    id: job.id,
    projectId: job.projectId,
    kind: job.kind,
    phase: job.phase,
    progress: null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
  };
  if (job.status === "succeeded") {
    return {
      ...shared,
      kind: job.kind,
      status: "succeeded",
      finishedAt: job.finishedAt ?? job.createdAt,
      result: job.result,
      error: null,
    } as Job;
  }
  if (job.status === "failed") {
    return {
      ...shared,
      kind: job.kind,
      status: "failed",
      finishedAt: job.finishedAt ?? job.createdAt,
      result: null,
      error: job.error,
    } as Job;
  }
  if (job.status === "cancelled") {
    return {
      ...shared,
      kind: job.kind,
      status: "cancelled",
      finishedAt: job.finishedAt ?? job.createdAt,
      result: null,
      error: null,
    } as Job;
  }
  return {
    ...shared,
    kind: job.kind,
    status: job.status,
    finishedAt: null,
    result: null,
    error: null,
  } as Job;
}
