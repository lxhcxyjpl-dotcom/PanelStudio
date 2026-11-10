import { describe, expect, it } from "vitest";
import { CandidateSchema } from "./candidate.js";
import { CapabilitiesResponseSchema, HealthResponseSchema, PHASE0_CAPABILITY_SAMPLE } from "./api.js";
import { APP_VERSION, SCHEMA_VERSION } from "./constants.js";
import { AIProviderSettingsSchema } from "./ai.js";
import { JobSchema } from "./jobs.js";
import { CandidateRowSchema } from "./storage.js";
import { ASSET_ID, expectInvalid, expectValid, PANEL_ID, PROJECT_ID } from "./test-utils.js";

const timestamp = "2026-01-01T00:00:00.000Z";

describe("API objects", () => {
  it("validates health and the phase 0 capability sample", () => {
    expectValid(HealthResponseSchema, {
      status: "ok",
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
    });
    expectValid(CapabilitiesResponseSchema, PHASE0_CAPABILITY_SAMPLE);
  });

  it("keeps score off the public candidate and on the stored row", () => {
    expect(Object.keys(CandidateSchema.properties)).not.toContain("score");
    expect(Object.keys(CandidateSchema.properties)).not.toContain("scoreJson");
    expect(Object.keys(CandidateRowSchema.properties)).toContain("scoreJson");
    expect(Object.keys(CandidateRowSchema.properties)).not.toContain("previewDocument");
  });

  it("does not put a secret on provider settings", () => {
    const keys = Object.keys(AIProviderSettingsSchema.properties);
    expect(keys).toEqual(["configRevision", "hasSecret", "config"]);
    expect(JSON.stringify(AIProviderSettingsSchema)).not.toContain("encryptedSecret");
  });

  it("requires job results only after success", () => {
    const base = {
      id: PANEL_ID,
      projectId: PROJECT_ID,
      kind: "asset_import" as const,
      phase: "receiving",
      progress: null,
      createdAt: timestamp,
      startedAt: null,
    };
    expectValid(JobSchema, {
      ...base,
      status: "queued",
      finishedAt: null,
      result: null,
      error: null,
    });
    expectValid(JobSchema, {
      ...base,
      kind: "preview",
      status: "succeeded",
      startedAt: timestamp,
      finishedAt: timestamp,
      result: { artifactId: ASSET_ID },
      error: null,
      progress: { completed: 1, total: 1 },
    });
    expectInvalid(JobSchema, {
      ...base,
      status: "succeeded",
      finishedAt: timestamp,
      result: null,
      error: null,
    });
    expectInvalid(JobSchema, {
      ...base,
      kind: "preview",
      status: "succeeded",
      finishedAt: timestamp,
      result: { assetId: ASSET_ID },
      error: null,
    });
  });
});
