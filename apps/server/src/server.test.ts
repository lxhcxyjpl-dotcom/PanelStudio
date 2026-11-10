import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import Database from "better-sqlite3";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VERSION, SCHEMA_VERSION } from "@panelstudio/contracts";
import { createServer } from "./index.js";

describe("server wiring", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("serves health for the phase 2 build", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-"));
    directories.push(dataDir);
    const app = createServer({ dataDir });
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
