-- SQLite schema used by PanelStudio v0.1.0 at 47a7011, before versioned migrations.
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
