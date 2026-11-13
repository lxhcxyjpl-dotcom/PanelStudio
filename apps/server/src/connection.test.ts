import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./index.js";

const directories: string[] = [];
const apps: ReturnType<typeof createServer>[] = [];
const secret = "test-only-connection-secret";
function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "panelstudio-connection-"));
  directories.push(dataDir);
  const app = createServer({ dataDir }); apps.push(app);
  const config = { adapter: "openai-compatible", baseUrl: "https://provider.example/v1", model: "vision-example", capabilities: { imageInput: true, structuredOutput: "json_object" }, allowLocalEndpoint: false };
  const save = (payload: unknown, key = crypto.randomUUID(), route = "ai-connection") => app.inject({ method: "PUT", url: "/api/v1/settings/" + route,
    headers: { "idempotency-key": key, "content-type": "application/json" }, payload: JSON.stringify(payload) });
  const read = async () => (await app.inject({ method: "GET", url: "/api/v1/settings/ai-provider" })).json();
  return { app, dataDir, config, save, read };
}
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("panelstudio-connection-")) throw Error("Unexpected test directory");
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("connection form persistence", () => {
  it("stores settings and key once without exposing a plaintext key", async () => {
    const { dataDir, config, save, read } = setup();
    const key = crypto.randomUUID();
    const first = await save({ config, secret }, key);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ configRevision: 1, hasSecret: true, config });
    expect((await save({ config, secret }, key)).body).toBe(first.body);
    expect((await read()).configRevision).toBe(1);
    expect(first.body).not.toContain(secret);
    // Only this freshly created test database is inspected.
    const dbFiles = (await import("node:fs")).readdirSync(dataDir).filter(name => /sqlite|\.db/u.test(name));
    for (const name of dbFiles) expect(readFileSync(path.join(dataDir, name)).includes(Buffer.from(secret))).toBe(false);
  });
  it("preserves the key for the same endpoint but clears it when the service changes", async () => {
    const { config, save, read } = setup();
    await save({ config, secret });
    await save({ config: { ...config, baseUrl: config.baseUrl + "/chat/completions", model: "other-model" } });
    expect((await read()).hasSecret).toBe(true);
    await save({ config: { ...config, baseUrl: "https://other.example/v1" } });
    expect((await read()).hasSecret).toBe(false);
  });
  it("leaves both settings and key unchanged when a combined save is invalid", async () => {
    const { config, save, read } = setup();
    await save({ config, secret });
    const before = await read();
    expect((await save({ config: { ...config, model: "new-model" }, secret: "bad\nvalue" })).statusCode).toBe(400);
    expect((await save({ config: { ...config, baseUrl: "sk-test-value-in-wrong-field" }, secret })).statusCode).toBe(400);
    expect(await read()).toEqual(before);
  });
  it("does not carry a key across services through the older configuration endpoint", async () => {
    const { config, save, read } = setup();
    await save({ config, secret });
    expect((await save({ ...config, baseUrl: "https://new.example/v1" }, crypto.randomUUID(), "ai-provider")).statusCode).toBe(200);
    expect((await read()).hasSecret).toBe(false);
  });
});
