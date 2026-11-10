import { Resvg } from "@resvg/resvg-js";
import Database from "better-sqlite3";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { APP_VERSION, HealthResponseSchema, SCHEMA_VERSION } from "@panelstudio/contracts";
import { createServer } from "./index.js";

describe("server wiring", () => {
  it("does not register product routes", async () => {
    const app = createServer();
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("can validate the health schema", async () => {
    const app = createServer();
    app.get(
      "/api/v1/health",
      { schema: { response: { 200: HealthResponseSchema } } },
      async () => ({
        status: "ok" as const,
        appVersion: APP_VERSION,
        schemaVersion: SCHEMA_VERSION,
      }),
    );
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
    });
    await app.close();
  });

  it("loads the locked native libraries", () => {
    expect(typeof sharp).toBe("function");
    expect(typeof Resvg).toBe("function");
    const database = new Database(":memory:");
    const row = database.prepare("select 1 as ok").get() as { ok: number };
    expect(row.ok).toBe(1);
    database.close();
  });
});
