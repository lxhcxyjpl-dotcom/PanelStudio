import { expect, test, type Page } from "@playwright/test";

const action = (page: Page, key: string) => page.locator(`[data-action="${key}"]:visible`);

async function importPanels(page: Page) {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({
    theme: "light", locale: "zh-CN", motion: "off",
  })));
  await page.goto("/app");
  const files = ["A", "B", "C"].map((name, i) => ({
    name: name + ".svg", mimeType: "image/svg+xml",
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 32"><rect width="40" height="32" fill="${["#668977", "#8a7165", "#bdcaaf"][i]}"/></svg>`),
  }));
  await page.getByTestId("import-input").setInputFiles(files);
  await expect(page.locator(".panel-frame")).toHaveCount(3);
}

test("fits a taller candidate on first view and restores each manually adjusted camera", async ({ page }) => {
  await importPanels(page);
  const camera = page.locator(".camera");
  const transform = () => camera.evaluate(el => (el as HTMLElement).style.transform);
  await action(page, "zoom-in").click();
  const editing = await transform();

  await action(page, "layout-tools").click();
  await page.getByTestId("layout-button").click();
  const cards = page.getByTestId("candidate-card");
  await expect(cards).toHaveCount(3);
  await cards.last().click();
  await expect.poll(async () => {
    const paper = (await page.locator("[data-canvas-paper]").boundingBox())!;
    const canvas = (await page.getByTestId("canvas").boundingBox())!;
    return paper.width <= canvas.width && paper.height <= canvas.height &&
      paper.x >= canvas.x - 1 && paper.y >= canvas.y - 1 &&
      paper.x + paper.width <= canvas.x + canvas.width + 1 &&
      paper.y + paper.height <= canvas.y + canvas.height + 1;
  }).toBe(true);
  await action(page, "zoom-in").click();
  const zoomed = await transform();
  await cards.first().click();
  await cards.last().click();
  await expect.poll(transform).toBe(zoomed);
  await action(page, "manual-edit").click();
  await expect.poll(transform).toBe(editing);
});

test("keeps zoom and selection in phone drawers and commits crop percentages beside the fields", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importPanels(page);
  const panel = page.locator(".panel-frame").nth(1);
  await panel.click();
  await expect(panel).toHaveAttribute("data-selected", "true");
  const zoom = await action(page, "actual-size").innerText();
  await action(page, "mobile-properties").click();
  await expect(page.locator("#inspector-drawer-heading")).toHaveText("属性");
  await expect(action(page, "actual-size")).toHaveText(zoom);
  await expect(panel).toHaveAttribute("data-selected", "true");
  await action(page, "mobile-assets").click();
  await expect(page.locator("#assets-drawer-heading")).toBeVisible();
  await expect(action(page, "actual-size")).toHaveText(zoom);
  await action(page, "mobile-properties").click();
  await action(page, "enter-crop").click();
  const fields = page.locator(".crop-fields");
  const width = fields.getByRole("textbox", { name: "宽度 (%)", exact: true });
  const left = fields.getByRole("textbox", { name: "左侧 (%)", exact: true });
  const done = fields.locator('[data-action="crop-done"]');
  await expect(width).toHaveValue("100");
  await left.fill("20");
  await left.press("Enter");
  await expect(done).toBeDisabled();
  await width.fill("60");
  await width.press("Enter");
  await done.click();
  await expect(fields).toHaveCount(0);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  const panelId = await panel.getAttribute("data-panel-id");
  await expect.poll(async () => {
    const source = await page.request.get(`/api/v1/projects/${id}/document`);
    const { document } = await source.json();
    return document.panels[panelId!].cropNormalized;
  }).toEqual({ x: 0.2, y: 0, width: 0.6, height: 1 });
  await action(page, "close-inspector").click();
  await expect(action(page, "actual-size")).toHaveText(zoom);
  await expect(panel).toHaveAttribute("data-selected", "true");
  await action(page, "mobile-properties").click();
  await action(page, "select-its-label").click();
  const reset = action(page, "reset-label-text");
  await expect(reset).toHaveCount(0);
  const label = page.getByRole("textbox", { name: "内容", exact: true });
  await label.fill("B2");
  await label.press("Enter");
  await expect(reset).toBeVisible();
  await reset.click();
  await expect(reset).toHaveCount(0);
});
