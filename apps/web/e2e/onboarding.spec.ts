import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { uiFontSizes } from "@panelstudio/ui";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(repo, ".panelstudio/acceptance-interaction-20261113");
test.beforeAll(() => mkdirSync(output, { recursive: true }));
test.beforeEach(async ({ page }) => {
  await page.addInitScript(()=>localStorage.setItem("panelstudio.visual-reading","off"));
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ theme: "light", locale: "zh-CN", motion: "off" })));
});

async function checkTypeAndBounds(page: Page) {
  const sizes = await page.evaluate(() => [...new Set([...document.querySelectorAll("body *")].flatMap(node => {
    if (!(node instanceof HTMLElement) || node.closest(".paper,svg,[hidden],[inert],[aria-hidden=true],.sr-only") || !node.getClientRects().length) return [];
    const style = getComputedStyle(node);
    if (style.visibility !== "visible") return [];
    const text = [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
    const field = node.matches("textarea,select,input:not([type=checkbox],[type=radio],[type=file],[type=hidden])");
    const size = parseFloat(style.fontSize);
    // The phone composer uses 16 px to prevent a keyboard focus from zooming the page.
    if (window.innerWidth < 768 && size === 16 && node.matches(".chat-composer textarea,.wish-line textarea,.ai-composer textarea")) return [];
    return text || field ? [size] : [];
  }))]);
  expect(Object.values(uiFontSizes)).toEqual(expect.arrayContaining(sizes));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function openGuide(page: Page) {
  await page.locator("[data-action=project-menu]").click();
  await page.locator("[data-action=open-onboarding]").click();
}

test("the toolbar guide can be skipped and reopened and leads to an editable sample and export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/app");
  await expect(page.locator(".welcome-guide")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: path.join(output, "home-desktop.png") });
  await openGuide(page);
  await expect(page.getByRole("heading", { name: "把你的图稿放进来" })).toBeVisible();
  await checkTypeAndBounds(page);
  await page.screenshot({ animations: "disabled", path: path.join(output, "onboarding-desktop.png") });
  await page.locator("[data-action=skip-onboarding]").click();
  await page.reload();
  await expect(page.locator("[data-action=start-onboarding]")).toHaveCount(0);
  await openGuide(page);
  await page.locator("[data-action=onboarding-next]").click();
  await expect(page.getByRole("heading", { name: "说出你想要的排版" })).toBeVisible();
  await page.locator("[data-action=onboarding-back]").click();
  await expect(page.getByRole("heading", { name: "把你的图稿放进来" })).toBeVisible();
  await page.locator("[data-action=onboarding-next]").click();
  await page.locator("[data-action=onboarding-next]").click();
  await page.locator("[data-action=onboarding-sample]").click();
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openGuide(page);
  await expect(page.getByRole("heading", { name: "说出你想要的排版" })).toBeVisible();
  await page.getByRole("button", { name: "3 导出", exact: true }).click();
  await expect(page.locator("[data-action=onboarding-sample]")).toHaveCount(0);
  await page.locator("[data-action=onboarding-done]").click();
  await page.locator("[data-action=layout-tools]").click();
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  await page.locator("[data-action=apply-layout]").click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await page.getByTestId("export-button").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 SVG", exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.svg$/);
  expect(errors).toEqual([]);
});

test("home brief survives import; preferences save and remain editable after reload", async ({ page }) => {
  await page.goto("/app");
  const message = "A 和 B 并排";
  await page.getByTestId("start-brief").fill(message);
  // A composing Enter must never create a project or dismiss the input.
  await page.getByTestId("start-brief").dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const picker = page.waitForEvent("filechooser");
  await page.locator("[data-action=empty-import]").click();
  await (await picker).setFiles([path.join(repo, "fixtures/mixed/raster.png"), path.join(repo, "fixtures/mixed/photo.jpg")]);
  await page.locator("[data-action=start-send]").click();
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  await openGuide(page);
  await expect(page.getByRole("heading", { name: "满意后，再采用和导出" })).toBeVisible();
  await page.locator("[data-action=onboarding-done]").click();
  await page.locator("[data-action=layout-tools]").click();
  await page.getByRole("menuitem",{name:"排版目标"}).click();
  await expect(page.getByTestId("figure-message")).toHaveValue(message);
  await page.getByTestId("target-journal").fill("Nature Communications");
  await page.getByTestId("research-field").fill("肿瘤免疫");
  await page.getByRole("radio", { name: "对照" }).check();
  await checkTypeAndBounds(page);
  await page.screenshot({ animations: "disabled", path: path.join(output, "brief-desktop.png") });
  await page.locator("[data-action=save-publication]").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".panel-frame")).toHaveCount(2);
  await page.reload();
  await page.locator("[data-action=layout-tools]").click();
  await page.locator("[data-action=edit-publication]").click();
  await expect(page.getByTestId("target-journal")).toHaveValue("Nature Communications");
  await expect(page.getByTestId("figure-message")).toHaveValue(message);
  await expect(page.getByRole("radio", { name: "对照" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("small dark English screens keep the guide, brief, and conversation usable with four sizes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("**/settings/ai-provider", route => route.fulfill({ json: { hasSecret: false, configRevision: 0, config: null } }));
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ theme: "dark", locale: "en-US", motion: "off" })));
  await page.goto("/app");
  await checkTypeAndBounds(page);
  await page.screenshot({ animations: "disabled", path: path.join(output, "home-mobile-dark.png") });
  await openGuide(page);
  await checkTypeAndBounds(page);
  await page.screenshot({ animations: "disabled", path: path.join(output, "onboarding-mobile-dark.png") });
  await page.locator("[data-action=onboarding-next]").click();
  await checkTypeAndBounds(page);
  await page.locator("[data-action=skip-onboarding]").click();
  await page.getByTestId("start-brief").fill("Compare the treatment with control.");
  await page.getByTestId("start-brief").press("Shift+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByTestId("start-brief").press("Enter");
  await expect(page.locator(".opening-log")).toContainText("Compare the treatment with control.");
  const picker = page.waitForEvent("filechooser");
  await page.locator("[data-action=empty-import]").click();
  await (await picker).setFiles([path.join(repo,"fixtures/mixed/raster.png"),path.join(repo,"fixtures/mixed/photo.jpg")]);
  await page.locator("[data-action=start-send]").click();
  await expect(page.getByTestId("wish-workbench")).toContainText("First draft ready");
  await page.locator("[data-action=layout-tools]").click();
  await page.getByRole("menuitem",{name:"Figure brief"}).click();
  await expect(page.getByTestId("figure-message")).toHaveValue("Compare the treatment with control.");
  await checkTypeAndBounds(page);
  await page.getByRole("radio", { name: "Compact" }).check();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })).toBeInViewport();
  await page.screenshot({ animations: "disabled", path: path.join(output, "brief-mobile-dark.png") });
  await page.locator("[data-action=save-publication]").click();
  await page.locator("[data-action=mobile-refine]").click();
  await expect(page.getByTestId("ai-status")).toBeInViewport();
  await expect(page.getByTestId("ai-prompt")).toHaveCount(0);
  await checkTypeAndBounds(page);
  await page.screenshot({ animations: "disabled", path: path.join(output, "chat-mobile-dark.png") });
  await page.locator("[data-action=layout-tools]").click();
  await page.locator("[data-action=edit-publication]").click();
  const brief = page.getByRole("dialog");
  const result = brief.getByTestId("figure-message");
  await expect(result).toBeInViewport();
  // Hit-test the visual layers as well as the focus trap. Radix normally disables
  // pointer events outside the dialog, which can mask a drawer painted over it.
  const isOnTop = await result.evaluate(field => {
    const rect = field.getBoundingClientRect(), style = document.createElement("style");
    style.textContent = ".sidebar, .drawer-backdrop { pointer-events: auto !important }";
    document.head.append(style);
    try { return document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2) === field; }
    finally { style.remove(); }
  });
  expect(isOnTop).toBe(true);
  await brief.getByRole("radio", { name: "Compare" }).check();
  await page.locator("[data-action=save-publication]").click();
  await expect(brief).toHaveCount(0);
  await expect(page.getByTestId("ai-status")).toBeInViewport();
  await page.locator("[data-action=close-inspector]").click();
  await expect(page.getByTestId("wish-input")).toBeInViewport();
});
