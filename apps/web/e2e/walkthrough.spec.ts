import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { fixtureIntent, type FrozenScene } from "../../../packages/ai/src/index.ts";

/**
 * In-app half of the handbook demo.
 * The model is the local corpus stand-in used by the phase 5 tests.
 * Illustrator is not part of this recording.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const assets = path.join(root, "examples/synthetic-six/assets");
const shots = path.join(root, "docs/screenshots");
const SECRET = "ephemeral-test-secret";

if (process.env.PANELSTUDIO_VIDEO === "1" || process.env.PANELSTUDIO_CAPTURE_V02 === "1") {
  test.use({ video: { mode: "on", size: { width: 1440, height: 900 } } });
}
const figures = ["line.svg", "bars.svg", "scatter.svg", "schematic.svg", "histogram.svg", "heatmap.svg"].map((name) =>
  path.join(assets, name),
);

test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole("dialog", { name: /^(排版目标|Figure brief)$/ }), async () => {
    await page.locator('[data-action="skip-publication"]').click();
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ theme: "light", locale: "zh-CN", motion: "off", reduceTransparency: false, leftWidth: 240, rightWidth: 352 }),
    );
  });
});

test("imports six drawings, lays them out, applies one sentence, and exports SVG", async ({ page }) => {
  const provider = await fixtureProvider();
  try {
    await page.goto("/app");
    await beat(page);
    await shot(page, "01-empty");
    await page.getByTestId("import-input").setInputFiles(figures);
    await expect(page.getByText(/已导入/).first()).toBeVisible();
    await page.getByRole("tab", { name: "面板" }).click();
    await expect(page.getByTestId("panel-row")).toHaveCount(6);
    await beat(page);
    await shot(page, "02-imported");
    await page.getByTestId("layout-button").click();
    await expect(page.getByTestId("candidate-card").first()).toContainText("均衡分行");
    await expect(page.getByTestId("candidate-card").first().locator("img")).toBeVisible();
    await beat(page);
    await shot(page, "03-layout");
    await page.getByRole("button", { name: "应用此版" }).click();
    await expect(page.getByTestId("save-status")).toHaveText("已保存");
    await beat(page);
    await shot(page, "04-laid-out");
    await configure(page, provider.port);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await page.getByTestId("ai-prompt").fill("把 C 放左边作为主图");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByTestId("ai-proposal")).toBeVisible();
    await beat(page);
    await shot(page, "05-ai-primary");
    await page.locator("[data-action=ai-apply]").click();
    await expect(page.getByTestId("save-status")).toHaveText("已保存");
    const download = page.waitForEvent("download");
    await page.getByTestId("export-button").click();
    await page.getByRole("button", { name: "可编辑 SVG" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.svg$/);
    const svg = await readAll(await file.createReadStream());
    expect(svg).toContain('font-family="Noto Sans"');
    expect(svg).toContain("<text");
    expect(svg).not.toContain("@font-face");
    await expect(page.getByTestId("font-status")).toContainText("Noto Sans");
    await beat(page);
    await shot(page, "06-export");
  } finally {
    provider.close();
  }
});

test("v0.2 six-panel continuous refinement, local row and editable export", async ({ page }) => {
  const provider = await fixtureProvider();
  const capture = process.env.PANELSTUDIO_CAPTURE_V02 === "1";
  const examples = path.join(root, "examples/refinement-six");
  const images = path.join(root, "docs/acceptance-v0.2/workspace");
  const button = (action: string) => page.locator('[data-action="' + action + '"]');
  const shotStage = async (name: string) => {
    if (!capture) return;
    mkdirSync(images, { recursive: true });
    await page.waitForTimeout(750);
    await page.screenshot({ path: path.join(images, name + ".png") });
  };
  try {
    await page.goto("/app");
    await configure(page, provider.port);
    await page.getByTestId("import-input").setInputFiles([...figures.slice(0, 5), path.join(assets, "heatmap.png")]);
    await button("tab-panels").click();
    await expect(page.getByTestId("panel-row")).toHaveCount(6);
    await shotStage("01-six-panels");
    await page.getByTestId("layout-button").click();
    await expect(page.getByTestId("candidate-card").first().locator("img")).toBeVisible();
    const commit = async (action: () => Promise<unknown>) => {
      const done = page.waitForResponse(r => r.url().endsWith("/transactions") && r.request().method() === "POST");
      await action();
      const response = await done;
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    await page.getByTestId("candidate-card").nth(1).click();
    const original = await commit(() => button("apply-layout").click());
    const project = original.projectId;
    if (capture) {
      mkdirSync(examples, { recursive: true });
      const receipt = await page.request.post("/api/v1/projects/" + project + "/exports", {
        headers: { "idempotency-key": "demo-start" }, data: { revision: original.revision, format: "project", options: { includeBundledFonts: false } } });
      const id = (await receipt.json()).jobId;
      await expect.poll(async () => (await (await page.request.get("/api/v1/jobs/" + id)).json()).status).toBe("succeeded");
      const artifact = (await (await page.request.get("/api/v1/jobs/" + id)).json()).result.artifactId;
      writeFileSync(path.join(examples, "start.figurezip"), await (await page.request.get("/api/v1/artifacts/" + artifact + "/download")).body());
    }
    await button("tab-ai").click();
    for (const [round, prompt] of ["把六张图排成两行三列", "在这个草案上，把 A 的编号向右移动 1 mm。"].entries()) {
      await page.getByTestId("ai-prompt").fill(prompt);
      await button("ai-send").click();
      await expect(page.getByTestId("ai-turn").filter({ hasText: prompt })).toHaveAttribute("data-current", "true");
      await expect(button("ai-apply")).toBeEnabled();
      await shotStage(round ? "03-refined" : "02-first-draft");
    }
    await button("compare-original").click();
    await expect(button("compare-original")).toHaveAttribute("aria-pressed","true");
    await shotStage("04-root");
    await button("compare-draft").click();
    const accepted = await commit(() => button("ai-apply").click());
    expect(accepted.revision).toBe(original.revision + 1);
    expect(accepted.document.panels[accepted.document.panelOrder[2]].frameMm).not.toEqual(original.document.panels[original.document.panelOrder[2]].frameMm);
    expect(accepted.document.panels[accepted.document.panelOrder[0]].labelOverrides.offsetMm.x).toBeCloseTo(1, 5);
    await button("tab-properties").click();
    const [, b, c] = accepted.document.panelOrder;
    const hit = page.locator('[data-label-id="' + b + '"]');
    const bounds = await hit.boundingBox();
    if (!bounds) throw new Error("Label B is not visible");
    await commit(async () => {
      const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 6, y + 2, { steps: 6 }); await page.mouse.up();
    });
    await shotStage("05-label");
    await page.locator('[data-panel-id="' + b + '"]').click();
    await page.locator('[data-panel-id="' + c + '"]').click({ modifiers: ["Shift"] });
    await page.getByTestId("row-sizing").selectOption("equal-width");
    await button("selection-row").click();
    await expect(button("apply-layout")).toBeEnabled();
    await shotStage("06-local-row");
    const aligned = await commit(() => button("apply-layout").click());
    expect(aligned.document.panels[b].frameMm.width).toBeCloseTo(aligned.document.panels[c].frameMm.width, 4);
    const downloaded = page.waitForEvent("download");
    await page.getByTestId("export-button").click();
    await button("export-svg").click();
    const file = await downloaded;
    const svg = await readAll(await file.createReadStream());
    expect(svg).toContain("<image");
    expect(svg).toContain("<path");
    expect(svg.match(/id="panel-[^"]+-label"/g)).toHaveLength(6);
    if (capture) writeFileSync(path.join(examples, "refined.svg"), svg);
    await shotStage("07-export");
  } finally { provider.close(); }
});

async function beat(page: Page): Promise<void> {
  if (process.env.PANELSTUDIO_VIDEO === "1" || process.env.PANELSTUDIO_SHOTS === "1") {
    await page.waitForTimeout(1200);
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.PANELSTUDIO_SHOTS !== "1") return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

async function configure(page: Page, providerPort: number): Promise<void> {
  await page.getByRole("button", { name: "设置" }).click();
  await page.locator("[data-action=settings-ai]").click();
  await page.getByTestId("ai-base-url").fill(`http://127.0.0.1:${providerPort}/v1`);
  await page.getByTestId("ai-model").fill("fixture-model");
  await page.locator(".connection-advanced > summary").click();
  await page.getByTestId("ai-local").check();
  await page.getByTestId("ai-secret").fill(SECRET);
  await page.locator("[data-action=save-connection]").click();
  await expect(page.getByTestId("ai-secret-state")).toHaveText("已保存密钥");
  await page.getByRole("button", { name: "关闭" }).click();
}

async function fixtureProvider(): Promise<{ port: number; close: () => void }> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.url !== "/v1/chat/completions") {
        response.statusCode = 404;
        response.end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages?: Array<{ content?: unknown }> };
      const text = (body.messages ?? [])
        .map((message) => (typeof message.content === "string" ? message.content : ""))
        .find((value) => value.includes("PROMPT:\n"));
      const content = text
        ? JSON.stringify(intentFrom(text))
        : JSON.stringify({ version: 1, kind: "unsupported", reason: "No prompt." });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return { port, close: () => server.close() };
}

function intentFrom(text: string) {
  const prompt = text.slice(text.indexOf("PROMPT:\n") + "PROMPT:\n".length, text.indexOf("\nSCENE:\n"));
  const scene = JSON.parse(text.slice(text.indexOf("\nSCENE:\n") + "\nSCENE:\n".length)) as FrozenScene;
  return fixtureIntent(prompt, scene) ?? { version: 1, kind: "unsupported", reason: "Unknown prompt." };
}
