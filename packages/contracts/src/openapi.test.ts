import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderOpenApiDocument } from "./openapi.js";

const openApiPath = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/openapi.json");

const paths = [
  "GET /api/v1/health",
  "GET /api/v1/capabilities",
  "GET /api/v1/projects",
  "POST /api/v1/projects",
  "GET /api/v1/projects/{projectId}",
  "PATCH /api/v1/projects/{projectId}",
  "DELETE /api/v1/projects/{projectId}",
  "POST /api/v1/projects/{projectId}/restore",
  "GET /api/v1/projects/{projectId}/document",
  "GET /api/v1/projects/{projectId}/revisions",
  "GET /api/v1/projects/{projectId}/revisions/{revision}",
  "POST /api/v1/projects/{projectId}/transactions",
  "POST /api/v1/projects/{projectId}/history/undo",
  "POST /api/v1/projects/{projectId}/history/redo",
  "POST /api/v1/projects/{projectId}/assets",
  "GET /api/v1/projects/{projectId}/assets",
  "GET /api/v1/projects/{projectId}/assets/{assetId}",
  "GET /api/v1/projects/{projectId}/assets/{assetId}/content",
  "GET /api/v1/projects/{projectId}/assets/{assetId}/original",
  "GET /api/v1/projects/{projectId}/assets/{assetId}/thumbnail",
  "DELETE /api/v1/projects/{projectId}/assets/{assetId}",
  "POST /api/v1/projects/{projectId}/layout-candidates",
  "GET /api/v1/projects/{projectId}/candidates/{candidateId}",
  "POST /api/v1/projects/{projectId}/ai-layouts",
  "POST /api/v1/projects/{projectId}/previews",
  "POST /api/v1/projects/{projectId}/exports",
  "POST /api/v1/project-imports",
  "GET /api/v1/artifacts/{artifactId}/download",
  "GET /api/v1/settings/ai-provider",
  "PUT /api/v1/settings/ai-provider",
  "PUT /api/v1/settings/ai-provider/secret",
  "DELETE /api/v1/settings/ai-provider/secret",
  "POST /api/v1/settings/ai-provider/test",
  "GET /api/v1/fonts",
  "GET /api/v1/fonts/bundle",
  "GET /api/v1/jobs/{jobId}",
  "GET /api/v1/jobs/{jobId}/events",
  "POST /api/v1/jobs/{jobId}/cancel",
];

describe("OpenAPI", () => {
  const document = JSON.parse(renderOpenApiDocument()) as {
    openapi: string;
    paths: Record<string, Record<string, { parameters?: Array<{ name: string; required?: boolean }> }>>;
    components: { schemas: Record<string, unknown> };
  };

  it("covers the handbook routes and no others", () => {
    const actual = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(actual.sort()).toEqual([...paths].sort());
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).every((path) => path.startsWith("/api/v1"))).toBe(true);
  });

  it("requires an idempotency key on mutating posts and provider writes", () => {
    expect(headerNames("post", "/api/v1/projects")).toContain("Idempotency-Key");
    expect(headerNames("put", "/api/v1/settings/ai-provider/secret")).toContain("Idempotency-Key");
    expect(headerNames("delete", "/api/v1/settings/ai-provider/secret")).toContain(
      "Idempotency-Key",
    );
    expect(headerNames("get", "/api/v1/projects")).not.toContain("Idempotency-Key");
    expect(headerNames("patch", "/api/v1/projects/{projectId}")).not.toContain("Idempotency-Key");
    expect(headerNames("delete", "/api/v1/projects/{projectId}")).not.toContain("Idempotency-Key");
  });

  it("keeps internal storage fields out of the published contract", () => {
    const text = renderOpenApiDocument();
    expect(text).not.toContain("encryptedSecret");
    expect(text).not.toContain("blobPath");
    expect(text).not.toContain("~kind");
    expect(document.components.schemas.FigureDocumentV1).toMatchObject({
      additionalProperties: false,
    });
  });

  it("matches the committed document", () => {
    const rendered = renderOpenApiDocument();
    if (process.env.WRITE_OPENAPI === "1") writeFileSync(openApiPath, rendered);
    expect(readFileSync(openApiPath, "utf8")).toBe(rendered);
  });

  function headerNames(method: string, path: string): string[] {
    const parameters = document.paths[path]?.[method]?.parameters ?? [];
    return parameters.map((parameter) => parameter.name);
  }
});
