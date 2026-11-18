import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { uiFontSizes } from "@panelstudio/ui";

test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole("dialog", { name: /^(排版目标|Figure brief)$/ }), async () => {
    await page.locator('[data-action="skip-publication"]').click();
  });
});

const fixtures = fileURLToPath(new URL("../../../fixtures/mixed/", import.meta.url));
const allowed = Object.values(uiFontSizes);

async function expectStudioType(page: Page) {
  const sizes = await page.evaluate(() => {
    const seen = new Set<number>();
    for (const node of document.body.querySelectorAll("*")) {
      // The figure and its native SVG labels use the document's own type sizes.
      if (!(node instanceof HTMLElement) || node.closest(".paper,svg,[hidden],[inert],[aria-hidden=true],.sr-only")) continue;
      if (!node.getClientRects().length) continue;
      const style = getComputedStyle(node);
      if (style.visibility !== "visible") continue;
      const isField = node.matches("textarea,select,input:not([type=checkbox],[type=radio],[type=file],[type=hidden],[type=color])");
      const hasText = Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      if (isField || hasText) seen.add(parseFloat(style.fontSize));
    }
    return [...seen].sort((a, b) => a - b);
  });
  expect(sizes.length).toBeGreaterThan(0);
  expect(allowed).toEqual(expect.arrayContaining(sizes));
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

for (const { width, locale } of [{ width: 1440, locale: "zh-CN" }, { width: 320, locale: "en-US" }]) {
  test("uses the four studio sizes at " + width + " px in " + locale, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(locale => localStorage.setItem("panelstudio.prefs",
      JSON.stringify({ locale, theme: locale === "en-US" ? "dark" : "light", motion: "off" })), locale);
    await page.goto("/app");
    const title = page.getByRole("heading", { level: 1 });
    const headingSize = width < 760 ? uiFontSizes.heading : uiFontSizes.display;
    await expect(title).toHaveCSS("font-size", headingSize + "px");
    await expect(page.locator("[data-action=empty-import]")).toHaveCSS("font-size", "15px");
    await expectStudioType(page);
    await page.evaluate(() => document.documentElement.style.fontSize = "125%");
    await expect(title).toHaveCSS("font-size", headingSize * 1.25 + "px");
    await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));

    await page.getByTestId("import-input").setInputFiles([path.join(fixtures, "raster.png"), path.join(fixtures, "photo.jpg")]);
    await expect(page.locator(".panel-frame")).toHaveCount(2);
    await expect(page.getByTestId("save-status")).toHaveCSS("font-size", "13px");
    await expectStudioType(page);
    if (width < 1024) await page.locator("[data-action=drawer-assets]").click();
    await page.locator("[data-action=asset-menu]").first().click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await expectStudioType(page);
    await page.keyboard.press("Escape");
    if (width < 1024) await page.locator("[data-action=close-assets]").click();

    await page.locator("[data-action=guided-layout]").click();
    await expect(page.getByRole("dialog").getByRole("heading", { level: 2 })).toHaveCSS("font-size", "24px");
    await expectStudioType(page);
    await page.locator("[data-action=close-dialog]").click();
    await page.getByTestId("export-button").click();
    const fonts = page.getByRole("dialog").getByTestId("font-status");
    await expect(fonts).toBeHidden();
    await page.locator(".export-font-details summary").click();
    await expect(fonts).toBeVisible();
    await expect(fonts).toContainText("Noto Sans");
    await expectStudioType(page);
  });
}
