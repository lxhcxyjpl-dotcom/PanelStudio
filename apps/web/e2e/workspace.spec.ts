import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const raster = path.join(root, "fixtures/mixed/raster.png");
const photo = path.join(root, "fixtures/mixed/photo.jpg");
const script = path.join(root, "fixtures/rejected/script.svg");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({
        theme: "light",
        locale: "zh-CN",
        motion: "off",
        reduceTransparency: false,
        leftWidth: 240,
        rightWidth: 304,
      }),
    );
  });
});

test("imports, lays out, accepts, and exports through the real API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "从图片开始一张图" })).toBeVisible();
  const layoutCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/layout-candidates")) layoutCalls.push(request.postData() ?? "");
  });
  await importFigures(page, [raster, photo]);
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  expect(layoutCalls.length).toBeGreaterThan(0);
  expect(layoutCalls[0]).toContain('"family":"auto"');
  const summary = await page.getByTestId("candidate-card").first().innerText();
  expect(summary).toMatch(/均衡分行|主图在/);
  await shot(page, "phase4-layout-candidates");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "使用此布局" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByTestId("export-button").click();
  await page.getByRole("button", { name: "可编辑 SVG" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.svg$/);
  await expect(page.getByText("FONT_MISSING").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "再次下载" })).toBeEnabled();
  await shot(page, "phase4-import-layout-export");
  const buttons = page.locator("button:visible");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    await expect(button).toHaveAttribute("data-action", /.+/);
    if (await button.isDisabled()) {
      expect((await button.getAttribute("title"))?.length ?? 0).toBeGreaterThan(0);
    }
  }
});

test("completes undo, layout, and export from the keyboard", async ({ page }) => {
  await page.goto("/");
  await importFigures(page, [raster, photo]);
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Control+A");
  const nudged = page.waitForResponse((response) => response.url().includes("/transactions") && response.request().method() === "POST");
  await page.keyboard.press("ArrowRight");
  await nudged;
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("live")).toContainText("已撤销");
  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByTestId("live")).toContainText("已重做");
  await page.getByTestId("layout-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  await page.getByRole("button", { name: "使用此布局" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("candidate-card")).toHaveCount(0);
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("live")).toContainText("已撤销");
});

test("shows empty history, import failure, save failure, conflict, stale candidate, and font warning", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("live")).toContainText("没有可撤销的操作");
  await page.getByTestId("import-input").setInputFiles([raster, script]);
  await expect(page.getByText("script.svg", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "格式支持说明" }).click();
  await expect(page.getByRole("heading", { name: "SVG 首版支持范围" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "面板" }).click();
  await expect(page.getByTestId("panel-row")).toHaveCount(1);

  await page.getByTestId("import-input").setInputFiles(photo);
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
  const size = page.getByTestId("label-size");
  await size.fill("12");
  await size.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  await page.keyboard.press("Control+Z");
  await expect(page.getByText("布局候选已过期").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "使用此布局" })).toBeDisabled();

  await page.route("**/api/v1/projects/*/transactions", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "REQUEST_INVALID", message: "Unexpected server error.", requestId: "e2e", details: {} },
      }),
    }),
  );
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("保存失败，草稿已保留").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "下载恢复 JSON" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重试保存" })).toBeVisible();
  await page.unroute("**/api/v1/projects/*/transactions");
});

test("reports a real layout conflict and restores the project after reload", async ({ page }) => {
  await page.goto("/");
  await importFigures(page, [raster, photo]);
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
  const minWidth = page.getByTestId("min-width");
  await minWidth.fill("200");
  await minWidth.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  const conflict = page.waitForResponse((response) => response.url().includes("/layout-candidates"));
  await page.getByTestId("layout-button").click();
  const response = await conflict;
  expect(response.status()).toBe(422);
  await expect(page.getByText("布局约束无解").first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "面板" }).click();
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
});

test("switches theme tokens and English copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("toolbar").getByRole("button", { name: "导入图片" })).toBeVisible();
  const light = await token(page, "--ui-background");
  expect(light).toBe("#F5F5F7");
  const surface = await page.locator(".toolbar").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(surface).toBe("rgb(255, 255, 255)");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("主题").selectOption("dark");
  await expect.poll(() => token(page, "--ui-background")).toBe("#18181A");
  const darkSurface = await page.locator(".toolbar").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(darkSurface).toBe("rgb(34, 34, 37)");
  await page.getByLabel("语言").selectOption("en-US");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("toolbar").getByRole("button", { name: "Import images" })).toBeVisible();
  await expect(page.getByTestId("toolbar").getByRole("button", { name: "Auto layout" })).toBeVisible();
  await expect(page.getByText("No project yet").first()).toBeVisible();
  await shot(page, "phase4-dark-english");
});

test("keeps three columns at 1440, 1280, and 1024", async ({ page }) => {
  await page.goto("/");
  for (const [width, left, right] of [
    [1440, 240, 304],
    [1280, 240, 304],
    [1024, 208, 280],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => Math.round((await page.getByTestId("left-sidebar").boundingBox())?.width ?? 0)).toBe(left);
    await expect.poll(async () => Math.round((await page.getByTestId("right-sidebar").boundingBox())?.width ?? 0)).toBe(right);
    await expect(page.getByTestId("canvas")).toBeVisible();
    await expect(page.getByTestId("toolbar").getByRole("button", { name: "导入图片" })).toBeVisible();
    await expect(page.getByTestId("export-button")).toBeVisible();
    if (width === 1024) await shot(page, "phase4-width-1024");
  }
});

test("zeroes spatial motion when reduced motion is on", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ theme: "light", locale: "zh-CN", motion: "system", reduceTransparency: true, leftWidth: 240, rightWidth: 304 }),
    );
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-transparency", "true");
  const spatial = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-spatial").trim());
  const opacity = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-opacity").trim());
  expect(spatial).toBe("0ms");
  expect(opacity).toBe("80ms");
});

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.PANELSTUDIO_SHOTS !== "1") return;
  await page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

async function importFigures(page: Page, files: string[]): Promise<void> {
  await page.getByTestId("import-input").setInputFiles(files);
  await expect(page.getByText(/已导入|失败/).first()).toBeVisible();
  await page.getByRole("tab", { name: "面板" }).click();
}

async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);
}
