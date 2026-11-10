import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
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

if (process.env.PANELSTUDIO_VIDEO === "1") {
  test.use({ video: "on" });
}
const figures = ["line.svg", "bars.svg", "scatter.svg", "schematic.svg", "histogram.svg", "heatmap.svg"].map((name) =>
  path.join(assets, name),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ theme: "light", locale: "zh-CN", motion: "off", reduceTransparency: false, leftWidth: 240, rightWidth: 304 }),
    );
  });
});

test("imports six drawings, lays them out, applies one sentence, and exports SVG", async ({ page }) => {
  const provider = await fixtureProvider();
  try {
    await page.goto("/");
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
    await page.getByRole("button", { name: "使用此布局" }).click();
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
    await page.getByRole("button", { name: "应用修改" }).click();
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
  await page.getByTestId("ai-base-url").fill(`http://127.0.0.1:${providerPort}/v1`);
  await page.getByTestId("ai-model").fill("fixture-model");
  await page.getByTestId("ai-local").check();
  await page.getByRole("button", { name: "保存模型设置" }).click();
  await page.getByTestId("ai-secret").fill(SECRET);
  await page.getByRole("button", { name: "保存密钥" }).click();
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
