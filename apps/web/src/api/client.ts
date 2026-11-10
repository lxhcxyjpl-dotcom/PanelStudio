import type {
  ApiError,
  Asset,
  Candidate,
  CapabilitiesResponse,
  DomainCommand,
  ExportRequest,
  FigureDocumentV1,
  HealthResponse,
  Job,
  PreviewRequest,
  Project,
  TransactionResponse,
} from "@panelstudio/contracts";

const BASE = "/api/v1";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiError["error"]["details"];

  constructor(message: string, status: number, code: string, details: ApiError["error"]["details"] = {}) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type DocumentState = {
  projectId: string;
  revision: number;
  document: FigureDocumentV1;
  documentHash: string;
  history: { canUndo: boolean; canRedo: boolean };
};

export type AssetPage = { items: Asset[]; nextCursor: string | null };
export type LayoutCandidatesResponse = { candidates: Candidate[] };
export type DownloadedFile = { blob: Blob; filename: string; mediaType: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed.";
    throw new ApiClientError(message, 0, "NETWORK");
  }
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = isErrorBody(body) ? body.error : null;
    throw new ApiClientError(
      error?.message ?? response.statusText,
      response.status,
      error?.code ?? "REQUEST_INVALID",
      error?.details ?? {},
    );
  }
  return body as T;
}

function isErrorBody(value: unknown): value is ApiError {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === "object" && "code" in error && "message" in error);
}

function jsonInit(method: string, body: unknown, idempotencyKey?: string): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return { method, headers, body: JSON.stringify(body) };
}

export const api = {
  health(): Promise<HealthResponse> {
    return request("/health");
  },
  capabilities(): Promise<CapabilitiesResponse> {
    return request("/capabilities");
  },
  createProject(title: string, key: string): Promise<{ project: Project; revision: 0 }> {
    return request("/projects", jsonInit("POST", { title }, key));
  },
  project(projectId: string): Promise<Project> {
    return request(`/projects/${projectId}`);
  },
  renameProject(projectId: string, title: string): Promise<Project> {
    return request(`/projects/${projectId}`, jsonInit("PATCH", { title }));
  },
  document(projectId: string): Promise<DocumentState> {
    return request(`/projects/${projectId}/document`);
  },
  assets(projectId: string): Promise<AssetPage> {
    return request(`/projects/${projectId}/assets`);
  },
  async uploadAsset(projectId: string, file: File, key: string): Promise<{ assetId: string; jobId: string }> {
    const body = new FormData();
    body.append("file", file, file.name);
    return request(`/projects/${projectId}/assets`, {
      method: "POST",
      headers: { "idempotency-key": key },
      body,
    });
  },
  removeAsset(projectId: string, assetId: string): Promise<Asset> {
    return request(`/projects/${projectId}/assets/${assetId}`, { method: "DELETE" });
  },
  job(jobId: string): Promise<Job> {
    return request(`/jobs/${jobId}`);
  },
  transaction(
    projectId: string,
    body: { baseRevision: number; commands: DomainCommand[] } | { baseRevision: number; candidateId: string },
    key: string,
  ): Promise<TransactionResponse> {
    return request(`/projects/${projectId}/transactions`, jsonInit("POST", body, key));
  },
  undo(projectId: string, baseRevision: number, key: string): Promise<TransactionResponse> {
    return request(`/projects/${projectId}/history/undo`, jsonInit("POST", { baseRevision }, key));
  },
  redo(projectId: string, baseRevision: number, key: string): Promise<TransactionResponse> {
    return request(`/projects/${projectId}/history/redo`, jsonInit("POST", { baseRevision }, key));
  },
  layoutCandidates(
    projectId: string,
    body: { baseRevision: number; request: { family: "auto" | "rows" | "hero-top" | "hero-left" }; maxCandidates?: 1 | 2 | 3 },
    key: string,
  ): Promise<LayoutCandidatesResponse> {
    return request(`/projects/${projectId}/layout-candidates`, jsonInit("POST", body, key));
  },
  preview(projectId: string, body: PreviewRequest, key: string): Promise<{ jobId: string }> {
    return request(`/projects/${projectId}/previews`, jsonInit("POST", body, key));
  },
  exportFigure(projectId: string, body: ExportRequest, key: string): Promise<{ jobId: string }> {
    return request(`/projects/${projectId}/exports`, jsonInit("POST", body, key));
  },
  async importPackage(file: File, key: string): Promise<{ jobId: string }> {
    const body = new FormData();
    body.append("file", file, file.name);
    return request("/project-imports", {
      method: "POST",
      headers: { "idempotency-key": key },
      body,
    });
  },
  async download(path: string): Promise<DownloadedFile> {
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network request failed.";
      throw new ApiClientError(message, 0, "NETWORK");
    }
    if (!response.ok) {
      const text = await response.text();
      let code = "REQUEST_INVALID";
      let message = response.statusText;
      try {
        const body = JSON.parse(text) as ApiError;
        if (body.error) {
          code = body.error.code;
          message = body.error.message;
        }
      } catch {
        message = text || message;
      }
      throw new ApiClientError(message, response.status, code);
    }
    const header = response.headers.get("content-disposition") ?? "";
    const matched = /filename="([^"]*)"/.exec(header);
    return {
      blob: await response.blob(),
      filename: matched?.[1] || "download",
      mediaType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  },
};

export function contentUrl(projectId: string, assetId: string): string {
  return `${BASE}/projects/${projectId}/assets/${assetId}/content`;
}

export function thumbnailUrl(projectId: string, assetId: string): string {
  return `${BASE}/projects/${projectId}/assets/${assetId}/thumbnail`;
}

export async function waitForJob(jobId: string): Promise<Job> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = await api.job(jobId);
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new ApiClientError("The job did not finish.", 0, "NETWORK");
}

export function newKey(): string {
  return crypto.randomUUID();
}
