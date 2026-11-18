import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const action = (page: Page, name: string) => page.locator(`[data-action="${name}"]`);

test("a researcher can import two ggplot2 SVGs and a raster through the file picker and export editable text", async ({ page }, info) => {
  await page.goto("/app");
  const picker = page.waitForEvent("filechooser");
  await action(page, "empty-import").click();
  await (await picker).setFiles([
    path.join(root, "fixtures/scientific-svg/ggplot2-scatter.svg"),
    path.join(root, "fixtures/scientific-svg/ggplot2-scatter-natural-width.svg"),
    path.join(root, "fixtures/mixed/raster.png"),
  ]);
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  const later = action(page, "skip-publication");
  if (await later.isVisible()) await later.click();
  await action(page, "tab-assets").click();
  const raster = page.locator(".asset-card").filter({ hasText: "raster.png" });
  await expect(raster.getByRole("button", { name: /再添加一份|another copy/i })).toBeVisible();
  await raster.locator('[data-action="asset-menu"]').click();
  await action(page, "asset-info").click();
  await expect(page.getByRole("dialog")).toContainText(/\d+ × \d+ px/);
  await page.keyboard.press("Escape");
  await action(page, "export").click();
  const downloaded = page.waitForEvent("download");
  await action(page, "export-svg").click();
  const svg = info.outputPath("ggplot2-editable.svg");
  await (await downloaded).saveAs(svg);
  const output = readFileSync(svg, "utf8");
  expect(output).toContain("textLength=");
  expect(output).toMatch(/<text\b[^>]*>Weight<\/text>/);
  expect(output).toMatch(/<image\b/);
  await page.keyboard.press("Escape");
  await expect(action(page, "export")).toBeFocused();
});

test.describe("a collaborator on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "zh-CN" });
  test("can see examples, open a received package and inspect the artwork alongside its properties", async ({ page }, info) => {
    await page.goto("/");
    await action(page, "home-gallery").tap();
    await expect(action(page, "open-scientific-example").first()).toBeInViewport();
    await action(page, "close-gallery").tap();
    await action(page, "home-menu").tap();
    const picker = page.waitForEvent("filechooser");
    await action(page, "home-open-package").tap();
    await (await picker).setFiles(path.join(root, "examples/synthetic-six/synthetic-six.figurezip"));
    await expect(page.locator(".panel-frame")).toHaveCount(6);
    await action(page, "fit").tap();
    await action(page, "mobile-properties").tap();
    const canvas = page.getByTestId("canvas");
    const inspector = page.getByTestId("right-sidebar");
    await expect(inspector).toBeInViewport();
    await expect.poll(async () => {
      const paper = await page.locator(".paper").boundingBox();
      const panel = await inspector.boundingBox();
      const area = await canvas.boundingBox();
      return Boolean(paper && panel && area && paper.y >= area.y - 1 && paper.y + paper.height <= panel.y + 1);
    }).toBe(true);
    await expect.poll(async () => (await action(page, "select-label").first().boundingBox())?.width ?? 0).toBeGreaterThan(38);
    await page.screenshot({ path: info.outputPath("phone-live-inspector.png") });
  });
});
