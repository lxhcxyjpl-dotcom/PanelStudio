import { createServer, type Server } from "node:http";
import path from "node:path";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixtureIntent, type FrozenScene } from "../../../packages/ai/src/index.ts";
import { expect, test, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const raster = path.join(root, "fixtures/mixed/raster.png");
const photo = path.join(root, "fixtures/mixed/photo.jpg");
const SECRET = "ephemeral-test-secret";

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
          if (response.writableEnded || response.destroyed) return;
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
    await page.goto("/app");
    await importFigures(page, [raster, photo]);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await expect(page.getByTestId("ai-status")).toHaveText("未连接");
    await expect(page.locator('[data-action="fill-example"]:visible')).toHaveCount(0);
    await expect(page.getByTestId("ai-scope").locator("option:checked")).toHaveText("全图 · 2");
    await page.locator(".composer-options > summary").click();
    await page.getByRole("button", { name: "把 A 向右移动 2 mm" }).click();
    await expect(page.getByTestId("ai-prompt")).toHaveValue("把 A 向右移动 2 mm");
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    await page.getByRole("tab", { name: "属性" }).click();
    await expect(page.getByTestId("panel-row")).toHaveCount(2);
    await page.getByTestId("layout-button").click();
    await expect(page.getByTestId("candidate-card").first()).toBeVisible();
    await page.getByRole("button", { name: "使用此布局" }).click();
    await expect(page.getByTestId("save-status")).toHaveText("已保存");
    await page.getByTestId("default-label-settings").locator("summary").click();
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
    await page.goto("/app");
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

  test("refines the same draft three times, compares against the root, applies once and reconnects its history", async ({ page }) => {
    mode = "fixture";
    await page.goto("/app");
    await configure(page, port);
    await importFigures(page, [raster, photo]);
    await expect(page.getByTestId("panel-row")).toHaveCount(2);
    const id = await page.evaluate(() => localStorage.getItem("panelstudio.projectId"));
    const read = async () => (await page.request.get(`/api/v1/projects/${id}/document`)).json();
    const root = await read();
    const original = await frames(page);
    const requests: { context: {kind: string}; baseRevision: number }[] = [];
    page.on("request", (r) => { if (r.url().endsWith("/ai-layouts")) requests.push(r.postDataJSON()); });
    await page.locator("[data-action=tab-ai]").click();
    const prompt = page.getByTestId("ai-prompt");
    await prompt.fill("把 A 向右移动 2 mm");
    await page.locator("[data-action=tab-properties]").click();
    await page.locator("[data-action=tab-ai]").click();
    await expect(prompt).toHaveValue("把 A 向右移动 2 mm");
    for (let round = 1; round <= 3; round++) {
      await prompt.fill("把 A 向右移动 2 mm");
      await page.locator("[data-action=ai-send]").click();
      await expect(page.locator("[data-action=ai-apply]")).toBeEnabled();
      await expect(page.getByTestId("ai-change").first()).toContainText(`${round * 2} mm`);
      expect((await read()).revision).toBe(root.revision);
    }
    expect(requests.map((r) => r.context.kind)).toEqual(["revision","candidate","candidate"]);
    expect(requests.every((r) => r.baseRevision === root.revision)).toBe(true);
    const preview = await frames(page);
    await page.locator("[data-action=compare-original]").click();
    expect(await frames(page)).toEqual(original);
    await page.locator("[data-action=compare-draft]").click();
    expect(await frames(page)).toEqual(preview);
    const applied = page.waitForResponse((r) => r.url().endsWith("/transactions"));
    await page.locator("[data-action=ai-apply]").click(); expect((await applied).ok()).toBe(true);
    expect((await read()).revision).toBe(root.revision + 1);
    const undone = page.waitForResponse((r) => r.url().endsWith("/history/undo"));
    await page.locator("[data-action=undo]").click(); expect((await undone).ok()).toBe(true);
    expect((await read()).documentHash).toBe(root.documentHash);
    await page.reload();
    await page.locator("[data-action=tab-ai]").click();
    await expect(page.getByTestId("ai-turn")).toHaveCount(3);
    await expect(page.locator(".paper")).toHaveAttribute("data-view", "editing");
    await page.locator("[data-action=ai-history-toggle]").click();
    await page.locator("[data-action=open-history-draft]").last().click();
    await expect(page.locator("[data-action=ai-apply]")).toBeDisabled();
    await page.locator("[data-action=compare-original]").click();
    expect(await frames(page)).toEqual(original);
  });

  test("a deliberately held ten-second AI call leaves manual transactions responsive and returns a read-only result", async ({ page }) => {
    mode = "hold";
    try {
      await page.goto("/app");
      await configure(page, port);
      await importFigures(page, [raster, photo]);
      await expect(page.getByTestId("panel-row")).toHaveCount(2);
      const panels = page.locator(".panel-frame");
      const panelA = panels.first();
      await panelA.click();
      await page.locator("[data-action=tab-ai]").click();
      const scope = page.getByTestId("ai-scope");
      await scope.selectOption("selection");
      await expect(scope.locator("option:checked")).toHaveText("选中 A");
      await page.getByTestId("ai-prompt").fill("把 A 向右移动 2 mm");
      const request = page.waitForRequest(r => r.url().endsWith("/ai-layouts") && r.method() === "POST");
      await page.locator("[data-action=ai-send]").click();
      expect((await request).postDataJSON().selectedPanelIds).toEqual([await panelA.getAttribute("data-panel-id")]);
      await expect.poll(() => waiting.length).toBe(1);
      const hold = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
      const frame = page.locator("[data-panel-id]").first();
      const rect = await frame.boundingBox();
      if (!rect) throw Error("Panel A unavailable");
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const saved = page.waitForResponse((r) => r.url().endsWith("/transactions"), {timeout: 6_000});
      await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+12,y+12,{steps:4}); await page.mouse.up();
      expect((await saved).ok()).toBe(true);
      const edited = await frames(page);
      await panels.nth(1).click();
      await expect(scope).toBeDisabled();
      await expect(scope.locator("option:checked")).toHaveText("选中 A");
      await hold; release();
      await expect(page.locator("[data-action=ai-regenerate]")).toBeVisible();
      await expect(scope.locator("option:checked")).toHaveText("选中 B");
      await expect(page.getByTestId("ai-proposal")).toContainText("草案范围 · 选中 A");
      await expect(page.locator("[data-action=ai-apply]")).toBeDisabled();
      expect(await frames(page)).toEqual(edited);
      await page.locator("[data-action=compare-draft]").click();
      expect(await frames(page)).not.toEqual(edited);
      await page.locator("[data-action=ai-manual]").click();
      expect(await frames(page)).toEqual(edited);
    } finally { mode = "fixture"; release(); }
  });

  test("leaves the figure unchanged when the model output is invalid", async ({ page }) => {
    mode = "invalid";
    await page.goto("/app");
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
    await page.goto("/app");
    await page.getByRole("button", { name: "设置" }).click();
    await page.locator("[data-action=settings-ai]").click();
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByTestId("ai-provider-status")).toContainText("连接成功");
    await page.locator(".connection-advanced > summary").click();
    await page.getByRole("button", { name: "删除密钥" }).click();
    await expect(page.getByTestId("ai-secret-state")).toHaveText("");
    await page.locator("[data-action=test-provider]").click();
    await expect(page.getByText("请填写这个服务的 API 密钥。", { exact: true })).toBeVisible();
    await page.getByTestId("ai-secret").fill(SECRET);
    await page.locator("[data-action=save-connection]").click();
    await expect(page.getByTestId("ai-secret")).toHaveValue("");
    await expect(page.getByTestId("ai-secret-state")).toHaveText("已保存密钥");
    await page.getByRole("button", { name: "关闭" }).click();
  });

  test("cancels a running request", async ({ page }) => {
    mode = "hold";
    await page.goto("/app");
    await importFigures(page, [raster, photo]);
    await page.getByRole("tab", { name: "AI 布局" }).click();
    await page.getByTestId("ai-prompt").fill("把 A 向右移动 2 mm");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByRole("button", { name: "取消请求" })).toBeVisible();
    await page.getByRole("button", { name: "取消请求" }).click();
    await expect(page.getByTestId("ai-status")).toContainText("已取消");
    await expect(page.getByTestId("ai-prompt")).toHaveValue("把 A 向右移动 2 mm");
    release();
    mode = "fixture";
  });

  test("shows a stale proposal after the figure changes and stops a job when settings change", async ({ page }) => {
    mode = "fixture";
    await page.goto("/app");
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
    await page.getByRole("button", { name: "基于当前稿重新生成" }).click();
    await expect(page.getByRole("button", { name: "取消请求" })).toBeVisible();
    await page.getByRole("button", { name: "设置" }).click();
  await page.locator("[data-action=settings-ai]").click();
    await page.getByTestId("ai-model").fill("other-fixture-model");
    await page.locator("[data-action=save-connection]").click();
    await expect(page.getByText("模型设置已变化").first()).toBeVisible();
    release();
    mode = "fixture";
  });

  test("chat composer handles Enter, multiline and IME input, and stays visible beside a draft", async ({ page }) => {
    mode = "fixture";
    await page.goto("/app");
    await configure(page, port);
    await importFigures(page, [raster, photo]);
    await page.locator("[data-action=tab-ai]").click();
    const calls: string[] = [];
    page.on("request", request => { if (request.url().includes("/ai-layouts") && request.method() === "POST") calls.push(request.url()); });
    const prompt = page.getByTestId("ai-prompt");
    await prompt.fill("把 A 向右移动 2 mm");
    await prompt.press("Shift+Enter");
    await expect(prompt).toHaveValue("把 A 向右移动 2 mm\n");
    await prompt.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
    expect(calls).toEqual([]);
    await prompt.fill("把 A 向右移动 2 mm");
    await prompt.press("Enter");
    await expect(page.getByTestId("ai-proposal")).toBeVisible();
    await expect(prompt).toHaveValue("");
    expect(calls).toHaveLength(1);
    await expect(prompt).toBeInViewport();
    const output = path.join(root, ".panelstudio/acceptance-interaction-20261113");
    mkdirSync(output, { recursive: true });
    await page.screenshot({ animations: "disabled", path: path.join(output, "chat-draft-desktop.png") });
    await page.getByTestId("ai-thread").evaluate(element => { element.scrollTop = 0; });
    await expect(prompt).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    if (!await page.getByTestId("right-sidebar").isVisible()) await page.locator("[data-action=drawer-inspector]").click();
    await expect(prompt).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: path.join(output, "chat-draft-mobile.png") });
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
  await page.locator("[data-action=settings-ai]").click();
  await page.getByTestId("ai-base-url").fill(`http://127.0.0.1:${providerPort}/v1`);
  await page.getByTestId("ai-model").fill("fixture-model");
  await page.locator(".connection-advanced > summary").click();
  await page.getByTestId("ai-local").check();
  await page.getByTestId("ai-secret").fill(SECRET);
  await page.locator("[data-action=save-connection]").click();
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
