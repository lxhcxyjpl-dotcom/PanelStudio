import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const raster = path.join(root, "fixtures/mixed/raster.png");
const photo = path.join(root, "fixtures/mixed/photo.jpg");
const script = path.join(root, "fixtures/rejected/script.svg");

test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole("dialog", { name: /^(排版目标|Figure brief)$/ }), async () => {
    await page.locator('[data-action="skip-publication"]').click();
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({
        theme: "light",
        locale: "zh-CN",
        motion: "off",
        reduceTransparency: false,
        leftWidth: 240,
        rightWidth: 352,
      }),
    );
  });
});

test("imports, lays out, accepts, and exports through the real API", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "你想做一张什么图？" })).toBeVisible();
  const layoutCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/layout-candidates")) layoutCalls.push(request.postData() ?? "");
  });
  await importFigures(page, [raster, photo]);
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
  await page.locator("[data-action=layout-tools]").click();
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  expect(layoutCalls.length).toBeGreaterThan(0);
  expect(layoutCalls[0]).toContain('"family":"auto"');
  const summary = await page.getByTestId("candidate-card").first().innerText();
  expect(summary).toMatch(/单行|上排|每行|主图在/);
  await shot(page, "phase4-layout-candidates");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "应用此版" }).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByTestId("export-button").click();
  await page.getByRole("button", { name: "下载 SVG" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.svg$/);
  await expect(page.getByTestId("font-status")).toContainText("Noto Sans");
  await expect(page.getByText("FONT_MISSING")).toHaveCount(0);
  await expect(page.locator('[data-testid="export-diagnostics"] li')).toHaveCount(0);
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
  await page.goto("/app");
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
  await page.locator("[data-action=layout-tools]").click();
  await page.getByTestId("layout-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  await page.getByRole("button", { name: "应用此版" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("candidate-card")).toHaveCount(0);
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("live")).toContainText("已撤销");
});

test("shows empty history, import failure, save failure, conflict, stale candidate, and font warning", async ({ page }) => {
  await page.goto("/app");
  await page.locator("[data-action=empty-import]").focus();
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
  await expect(size).toBeHidden();
  await page.getByTestId("default-label-settings").locator("summary").click();
  await size.fill("12");
  await size.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.locator("[data-action=layout-tools]").click();
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  await page.keyboard.press("Control+Z");
  await expect(page.getByText("布局候选已过期").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "应用此版" })).toBeDisabled();

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
  await page.goto("/app");
  await importFigures(page, [raster, photo]);
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
  const minWidth = page.getByTestId("min-width");
  await page.getByText("排版约束", { exact: true }).click();
  await minWidth.fill("200");
  await minWidth.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  const conflict = page.waitForResponse((response) => response.url().includes("/layout-candidates"));
  await page.locator("[data-action=layout-tools]").click();
  await page.getByTestId("layout-button").click();
  const response = await conflict;
  expect(response.status()).toBe(422);
  const problem = await response.json();
  expect(problem.error).toMatchObject({ code: "LAYOUT_CONFLICT", details: { reason: "layout-min-size" } });
  await expect(page.getByText("有图块低于布局最小尺寸。", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", {name: "返回编辑", exact: true}).click();
  await expect(page.getByRole("tab", {name: "属性", exact: true})).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await page.getByRole("tab", { name: "面板" }).click();
  await expect(page.getByTestId("panel-row")).toHaveCount(2);
});

test("switches theme tokens and English copy", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("button", { name: "导入我的图" })).toBeVisible();
  const light = await token(page, "--ui-background");
  expect(light).toBe("#F7F7F5");
  const surface = await page.locator(".toolbar").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(surface).toBe("rgb(255, 255, 255)");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByLabel("主题").selectOption("dark");
  await expect.poll(() => token(page, "--ui-background")).toBe("#1C1C1B");
  const darkSurface = await page.locator(".toolbar").evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(darkSurface).toBe("rgb(36, 36, 35)");
  await page.getByLabel("语言").selectOption("en-US");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: "Add my images" })).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("No project yet");
  await page.getByTestId("import-input").setInputFiles([raster, photo]);
  await page.locator("[data-action=layout-tools]").click();
  await expect(page.getByRole("menuitem", { name: "Compare layouts" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await shot(page, "phase4-dark-english");
});

test("keeps three columns at 1440, 1280, and 1024", async ({ page }) => {
  await page.goto("/app");
  await importFigures(page, [raster, photo]);
  for (const [width, left, right] of [
    [1440, 240, 352],
    [1280, 240, 352],
    [1024, 208, 320],
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
      JSON.stringify({ theme: "light", locale: "zh-CN", motion: "system", reduceTransparency: true, leftWidth: 240, rightWidth: 352 }),
    );
  });
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
  await expect(page.locator("html")).toHaveAttribute("data-reduce-transparency", "true");
  const spatial = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-spatial").trim());
  const opacity = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-opacity").trim());
  expect(spatial).toBe("0ms");
  expect(opacity).toBe("80ms");
});

test("opens a recent figure and uses both sidebars and the reference form on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  await expect(page.getByRole("heading", { name: "你想做一张什么图？" })).toBeVisible();
  await expect.poll(pageWidth).toBe(390);
  await page.getByTestId("import-input").setInputFiles([raster, photo]);
  await expect(page.locator(".panel-frame")).toHaveCount(2);
  const title = "Mobile studio " + Date.now();
  const name = page.locator("input.project-name");
  await name.fill(title);
  const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/projects/"));
  await name.press("Enter"); await saved;
  await page.getByRole("button", { name: "项目菜单" }).click();
  await page.getByRole("menuitem", { name: "返回首页" }).click();
  await page.locator("[data-action=home-menu]").click();
  await page.getByRole("menuitem", { name: new RegExp(title) }).click();
  await expect(name).toHaveValue(title);
  await expect.poll(pageWidth).toBe(390);
  await expect(page.locator("[data-action=drawer-assets]")).toBeHidden();
  await page.locator("[data-action=mobile-assets]").click();
  await page.locator("[data-action=asset-menu]").first().click();
  await expect(page.getByRole("menuitem", { name: "查看素材信息" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("[data-action=close-assets]").click();
  await expect(page.locator("[data-action=drawer-inspector]")).toBeHidden();
  await page.locator("[data-action=mobile-properties]").click();
  await expect(page.getByLabel("宽度 (mm)", { exact: true })).toBeVisible();
  await page.locator("[data-action=close-inspector]").click();
  await expect(page.locator("[data-action=mobile-properties]")).toBeFocused();
  await page.locator("[data-action=layout-tools]").click();
  await page.locator("[data-action=guided-layout]").click();
  const submit = page.locator("[data-action=generate-guided]");
  await expect(submit).toBeInViewport();
  await page.getByTestId("guide-words").fill("间距 4 mm");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  await expect.poll(pageWidth).toBe(390);
});

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.PANELSTUDIO_SHOTS !== "1") return;
  await page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

async function importFigures(page: Page, files: string[]): Promise<void> {
  const panels = page.locator(".panel-frame");
  const existing = await panels.count();
  await page.getByTestId("import-input").setInputFiles(files);
  await expect(panels).toHaveCount(existing + files.length);
  await page.getByRole("tab", { name: "面板" }).click();
}

async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);
}
