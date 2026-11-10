import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const raster = path.join(root, "fixtures/mixed/raster.png");

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

test("opens, soft-deletes, and restores a project from the project menu", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("import-input").setInputFiles([raster]);
  await page.getByRole("tab", { name: "面板" }).click();
  await expect(page.getByTestId("panel-row")).toHaveCount(1);
  await rename(page, "Gap Alpha");
  await page.getByRole("button", { name: "项目菜单" }).click();
  await page.getByRole("menuitem", { name: "新建项目" }).click();
  await expect(page.getByRole("textbox", { name: "名称" })).toHaveValue("未命名图稿");
  await rename(page, "Gap Beta");
  await expect(page.getByTestId("panel-row")).toHaveCount(0);

  await openMenu(page);
  await page.getByTestId("open-project").hover();
  await page.getByRole("menuitem", { name: "Gap Alpha" }).click();
  await expect(page.getByRole("textbox", { name: "名称" })).toHaveValue("Gap Alpha");
  await expect(page.getByTestId("panel-row")).toHaveCount(1);

  await openMenu(page);
  const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/api/v1/projects/"));
  await page.getByTestId("delete-project").click();
  expect((await deleted).ok()).toBe(true);
  await expect(page.getByRole("textbox", { name: "名称" })).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toHaveText("还没有项目");

  await openMenu(page);
  await page.getByTestId("restore-project").hover();
  const restored = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/restore"));
  await page.getByRole("menuitem", { name: "Gap Alpha" }).click();
  expect((await restored).ok()).toBe(true);
  await expect(page.getByRole("textbox", { name: "名称" })).toHaveValue("Gap Alpha");
  await page.getByRole("tab", { name: "面板" }).click();
  await expect(page.getByTestId("panel-row")).toHaveCount(1);
  await expect(page.getByTestId("live")).toContainText("项目已恢复");
});

async function openMenu(page: Page): Promise<void> {
  const listed = page.waitForResponse(
    (response) => response.request().method() === "GET" && response.url().includes("/api/v1/projects?") && response.url().includes("includeDeleted=true"),
  );
  await page.getByRole("button", { name: "项目菜单" }).click();
  expect((await listed).ok()).toBe(true);
}

async function rename(page: Page, title: string): Promise<void> {
  const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/api/v1/projects/"));
  const input = page.getByRole("textbox", { name: "名称" });
  await input.fill(title);
  await input.press("Enter");
  expect((await saved).ok()).toBe(true);
  await expect(input).toHaveValue(title);
}
