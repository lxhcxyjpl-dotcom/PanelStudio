import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { uiFontSizes } from "@panelstudio/ui";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const output = path.join(repo, ".panelstudio/acceptance-interior-20261113");
let mock: Server;
let port = 0;
let calls = 0;
test.beforeAll(async () => {
  mkdirSync(output, { recursive: true });
  mock = createServer((request, response) => {
    request.resume(); request.on("end", () => {
      calls++;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  mock.listen(0, "127.0.0.1"); await once(mock, "listening");
  const address = mock.address(); port = address && typeof address === "object" ? address.port : 0;
});
test.afterAll(() => mock.close());
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ theme: "light", locale: "zh-CN", motion: "off" })));
  await page.goto("/");
});

async function openConnection(page: Page) {
  await page.locator("[data-action=settings]").click();
  await page.locator("[data-action=settings-ai]").click();
}
async function checkFourSizes(page: Page) {
  const seen = await page.evaluate(() => [...new Set([...document.querySelectorAll("[role=dialog] *")].flatMap(node => {
    if (!(node instanceof HTMLElement) || node.closest("svg,.sr-only,[hidden],[aria-hidden=true]") || !node.getClientRects().length || getComputedStyle(node).visibility !== "visible") return [];
    const text = [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
    return text || node.matches("input:not([type=checkbox]),select,textarea") ? [parseFloat(getComputedStyle(node).fontSize)] : [];
  }))]);
  expect(Object.values(uiFontSizes)).toEqual(expect.arrayContaining(seen));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("explains a key in the URL field and supports provider presets without calling them", async ({ page }) => {
  const saves: string[] = [];
  page.on("request", request => { if (request.method() === "PUT" && request.url().includes("/settings/")) saves.push(request.url()); });
  await openConnection(page);
  await page.getByTestId("ai-service").selectOption("deepseek");
  await expect(page.getByTestId("ai-base-url")).toHaveValue("https://api.deepseek.com");
  await expect(page.getByTestId("ai-model")).toHaveValue("deepseek-flash");
  await expect(page.getByTestId("ai-image")).toBeChecked();
  await expect(page.getByTestId("ai-local")).not.toBeChecked();
  await checkFourSizes(page);
  await page.screenshot({ path: path.join(output, "connection-deepseek.png"), animations: "disabled" });
  await page.getByTestId("ai-model").fill("deepseek-v4-pro");
  await expect(page.getByTestId("ai-image")).toBeDisabled();
  await expect(page.getByTestId("ai-image")).not.toBeChecked();
  await page.getByTestId("ai-base-url").fill("sk-test-value-in-the-wrong-field");
  await page.locator("[data-action=save-connection]").click();
  await expect(page.getByText(/这里需要网址/)).toBeVisible();
  expect(saves).toEqual([]);
  await page.getByTestId("ai-service").selectOption("openrouter");
  await expect(page.getByTestId("ai-base-url")).toHaveValue("https://openrouter.ai/api/v1");
  await page.getByTestId("ai-service").selectOption("custom");
  await expect(page.getByTestId("ai-base-url")).toHaveValue("");
  await expect(page.getByTestId("ai-model")).toHaveValue("");
  expect(calls).toBe(0);
});

test("saves a complete connection once, tests it, preserves its key and requires a new one for another service", async ({ page }) => {
  await openConnection(page);
  await page.getByTestId("ai-service").selectOption("custom");
  await page.getByTestId("ai-base-url").fill("http://127.0.0.1:" + port + "/v1");
  await page.getByTestId("ai-model").fill("test-model");
  await page.getByTestId("ai-secret").fill("test-only-browser-connection-key");
  await page.locator(".connection-advanced > summary").click();
  await page.getByTestId("ai-local").check();
  const saved = page.waitForResponse(response => response.url().endsWith("/settings/ai-connection") && response.request().method() === "PUT");
  await page.locator("[data-action=test-provider]").click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain("test-only-browser-connection-key");
  await expect(page.getByTestId("ai-provider-status")).toContainText("连接成功");
  await expect(page.getByTestId("ai-secret")).toHaveValue("");
  await expect(page.getByTestId("ai-secret-state")).toHaveText("已保存密钥");
  expect(calls).toBe(1);
  await page.reload(); await openConnection(page);
  await expect(page.getByTestId("ai-secret")).toHaveValue("");
  await expect(page.getByTestId("ai-secret")).toHaveAttribute("placeholder", "已保存；留空可继续使用");
  await page.getByTestId("ai-service").selectOption("deepseek");
  await expect(page.getByText("服务地址已改变，请填写这个服务对应的密钥。")).toBeVisible();
  await page.locator("[data-action=test-provider]").click();
  await expect(page.getByText("请填写这个服务的 API 密钥。", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  const stored = await (await page.request.get("/api/v1/settings/ai-provider")).json();
  expect(stored.config.baseUrl).toBe("http://127.0.0.1:" + port + "/v1");
});

test("connection works on a narrow English screen and the editor has a calmer hierarchy", async ({ page }) => {
  await page.locator("#package-input").setInputFiles(path.join(repo, "examples/refinement-six/start.figurezip"));
  await expect(page.locator(".panel-frame")).toHaveCount(6);
  await page.screenshot({ path: path.join(output, "editor-properties.png"), animations: "disabled" });
  await page.locator("[data-action=tab-ai]").click();
  await expect(page.getByTestId("ai-prompt")).toBeInViewport();
  await page.screenshot({ path: path.join(output, "editor-conversation.png"), animations: "disabled" });
  await page.locator("[data-action=settings]").click();
  await page.getByLabel("语言").selectOption("en-US");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator("[data-action=settings-ai]").click();
  await page.getByTestId("ai-service").selectOption("deepseek");
  await checkFourSizes(page);
  await page.locator("[data-action=test-provider]").click();
  await expect(page.getByText("Enter the API key for this service.", { exact: true })).toBeVisible();
  await expect(page.locator("[data-action=close-dialog]")).toBeInViewport();
  await page.screenshot({ path: path.join(output, "connection-mobile.png"), animations: "disabled" });
});
