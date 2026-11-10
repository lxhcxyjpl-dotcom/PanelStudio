import { createServer, type Server } from "node:http";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { fixtureIntent, type FrozenScene } from "../../../packages/ai/src/index.ts";
import { expect, test, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const raster = path.join(root, "fixtures/mixed/raster.png");
const photo = path.join(root, "fixtures/mixed/photo.jpg");
const SECRET = "ephemeral-test-secret";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ theme: "light", locale: "zh-CN", motion: "off", reduceTransparency: false, leftWidth: 240, rightWidth: 304 }),
    );
  });
});

test.describe.serial("phase 5 AI", () => {
  let server: Server;
  let port = 0;
  let mode: "fixture" | "invalid" | "hold" = "fixture";
  const waiting: Array<() => void> = [];
  function release(): void {
    for (const resume of waiting.splice(0)) resume();
  }

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        void (async () => {
          if (request.url !== "/v1/chat/completions") {
            response.statusCode = 404;
            response.end();
            return;
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
          if (mode === "hold") {
            await new Promise<void>((resolve) => waiting.push(resolve));
          }
          if (response.writableEnded || request.destroyed) return;
          const content = mode === "invalid" ? "this is not an intent {{{" : JSON.stringify(intentFor(body));
          response.setHeader("content-type", "application/json");
          try {
            response.end(JSON.stringify({ choices: [{ message: { content } }] }));
          } catch {
            // The client aborted the held request.
          }
        })();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    port = address && typeof address === "object" ? address.port : 0;
  });

  test.afterAll(() => {
    for (const release of waiting.splice(0)) release();
    server.close();
  });

  test("keeps import, layout, edit, and export working when AI is not configured", async ({ page }) => {
    const aiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/ai-layouts")) aiCalls.push(request.url());
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await expect(page.getByTestId("ai-status")).toContainText("AI 尚未配置");
    await page.getByRole("button", { name: "把 A 向右移动 2 mm" }).click();
    await expect(page.getByTestId("ai-prompt")).toHaveValue("把 A 向右移动 2 mm");
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    await page.getByRole("tab", { name: "属性" }).click();
    await importFigures(page, [raster, photo]);
    await expect(page.getByTestId("panel-row")).toHaveCount(2);
    await page.getByTestId("layout-button").click();
    await expect(page.getByTestId("candidate-card").first()).toBeVisible();
    await page.getByRole("button", { name: "使用此布局" }).click();
    await expect(page.getByTestId("save-status")).toHaveText("已保存");
    const size = page.getByTestId("label-size");
    await size.fill("11");
    await size.press("Enter");
    await expect(page.getByTestId("save-status")).toHaveText("已保存");
    const download = page.waitForEvent("download");
    await page.getByTestId("export-button").click();
    await page.getByRole("button", { name: "可编辑 SVG" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.svg$/);
    expect(aiCalls).toEqual([]);
  });

  test("compiles a fixture proposal, and the preview matches the accepted document", async ({ page }) => {
    mode = "fixture";
    await page.goto("/");
    await configure(page, port);
    const stored = await page.request.get("/api/v1/settings/ai-provider");
    expect(await stored.text()).not.toContain(SECRET);
    await importFigures(page, [raster, photo]);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    const original = await frames(page);
    await page.getByTestId("ai-prompt").fill("把 A 向右移动 2 mm");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByTestId("ai-proposal")).toBeVisible();
    const preview = await frames(page);
    expect(preview).not.toEqual(original);
    await page.getByRole("button", { name: "应用修改" }).click();
    await expect(page.getByTestId("save-status")).toHaveText("已保存");
    expect(await frames(page)).toEqual(preview);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await page.getByTestId("ai-prompt").fill("撤销");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByTestId("live")).toContainText("已撤销");
    expect(await frames(page)).toEqual(original);
  });

  test("leaves the figure unchanged when the model output is invalid", async ({ page }) => {
    mode = "invalid";
    await page.goto("/");
    await importFigures(page, [raster, photo]);
    const original = await frames(page);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await page.getByTestId("ai-prompt").fill("删除所有面板");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByTestId("ai-status")).toContainText("模型返回的内容无效");
    expect(await frames(page)).toEqual(original);
    mode = "fixture";
  });

  test("reports a provider test and a missing secret", async ({ page }) => {
    mode = "fixture";
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByTestId("ai-provider-status")).toContainText("连接成功");
    await page.getByRole("button", { name: "删除密钥" }).click();
    await expect(page.getByTestId("ai-secret-state")).toHaveText("还没有密钥");
    await expect(page.getByRole("button", { name: "测试连接" })).toBeDisabled();
    await page.getByTestId("ai-secret").fill(SECRET);
    await page.getByRole("button", { name: "保存密钥" }).click();
    await expect(page.getByTestId("ai-secret")).toHaveValue("");
    await expect(page.getByTestId("ai-secret-state")).toHaveText("已保存密钥");
    await page.getByRole("button", { name: "关闭" }).click();
  });

  test("cancels a running request", async ({ page }) => {
    mode = "hold";
    await page.goto("/");
    await importFigures(page, [raster, photo]);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await page.getByTestId("ai-prompt").fill("把 A 向右移动 2 mm");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("button", { name: "取消请求" })).toBeVisible();
    await page.getByRole("button", { name: "取消请求" }).click();
    await expect(page.getByTestId("ai-status")).toContainText("已取消");
    release();
    mode = "fixture";
  });

  test("shows a stale proposal after the figure changes and stops a job when settings change", async ({ page }) => {
    mode = "fixture";
    await page.goto("/");
    await importFigures(page, [raster, photo]);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await page.getByTestId("ai-prompt").fill("把 A 向右移动 2 mm");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByTestId("ai-proposal")).toBeVisible();
    await page.getByRole("button", { name: "继续手动编辑" }).click();
    await page.getByTestId("canvas").focus();
    await page.keyboard.press("Control+A");
    const saved = page.waitForResponse((response) => response.url().includes("/transactions") && response.request().method() === "POST");
    await page.keyboard.press("ArrowRight");
    await saved;
    await expect(page.getByText("这份 AI 预览已过期").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "应用修改" })).toBeDisabled();

    mode = "hold";
    await page.getByTestId("ai-prompt").fill("面板间距改成 3 mm");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("button", { name: "取消请求" })).toBeVisible();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByTestId("ai-model").fill("other-fixture-model");
    await page.getByRole("button", { name: "保存模型设置" }).click();
    await expect(page.getByText("模型设置已变化").first()).toBeVisible();
    release();
    mode = "fixture";
  });
});

function intentFor(body: unknown) {
  const messages = (body as { messages?: Array<{ content?: unknown }> }).messages ?? [];
  const text = messages.map((message) => (typeof message.content === "string" ? message.content : "")).find((value) => value.includes("PROMPT:\n"));
  if (!text) return { version: 1, kind: "unsupported", reason: "No prompt." };
  const prompt = text.slice(text.indexOf("PROMPT:\n") + "PROMPT:\n".length, text.indexOf("\nSCENE:\n"));
  const scene = JSON.parse(text.slice(text.indexOf("\nSCENE:\n") + "\nSCENE:\n".length)) as FrozenScene;
  return fixtureIntent(prompt, scene) ?? { version: 1, kind: "unsupported", reason: "Unknown prompt." };
}

async function configure(page: Page, providerPort: number): Promise<void> {
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByTestId("ai-base-url").fill(`http://127.0.0.1:${providerPort}/v1`);
  await page.getByTestId("ai-model").fill("fixture-model");
  await page.getByTestId("ai-local").check();
  await page.getByRole("button", { name: "保存模型设置" }).click();
  await expect(page.getByTestId("ai-provider-status")).toContainText("保存模型设置");
  await page.getByTestId("ai-secret").fill(SECRET);
  await page.getByRole("button", { name: "保存密钥" }).click();
  await expect(page.getByTestId("ai-secret")).toHaveValue("");
  await expect(page.getByTestId("ai-secret-state")).toHaveText("已保存密钥");
  await page.getByRole("button", { name: "关闭" }).click();
}

async function importFigures(page: Page, files: string[]): Promise<void> {
  await page.getByTestId("import-input").setInputFiles(files);
  await expect(page.getByText(/已导入|失败/).first()).toBeVisible();
  await page.getByRole("tab", { name: "面板" }).click();
}

async function frames(page: Page): Promise<string[]> {
  return page.locator("[data-frame]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-frame") ?? ""));
}
