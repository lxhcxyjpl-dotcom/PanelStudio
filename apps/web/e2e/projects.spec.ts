import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { Project } from "@panelstudio/contracts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const raster = path.join(root, "fixtures/mixed/raster.png");

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

test("distinguishes empty collections, an unmatched search and a failed project request", async ({ page }) => {
  const date = "2026-11-18T00:00:00.000Z";
  const project: Project = { id: crypto.randomUUID(), title: "免疫荧光", createdAt: date, updatedAt: date, deletedAt: null, currentRevision: 0 };
  let items: Project[] = [];
  let available = true;
  await page.route(url => url.pathname === "/api/v1/projects" && url.searchParams.get("includeDeleted") === "true", route =>
    available ? route.fulfill({ json: { items, nextCursor: null } }) : route.fulfill({ status: 503, json: {} }));
  await page.setViewportSize({ width: 390, height: 844 });
  const open = page.getByRole("button", { name: "所有项目", exact: true });
  const dialog = page.getByRole("dialog", { name: "所有项目" });
  const search = dialog.getByRole("textbox", { name: "搜索项目" });
  const empty = dialog.getByRole("status");
  const trash = dialog.getByRole("button", { name: "回收站", exact: true });
  await page.goto("/");
  await open.click();
  await expect(empty).toHaveText("暂无项目");
  await trash.click();
  await expect(empty).toHaveText("回收站为空");

  items = [project];
  await page.reload();
  await open.click();
  await search.fill("  免疫荧光  ");
  await expect(dialog.getByRole("button", { name: project.title, exact: true })).toBeVisible();
  await search.fill("找不到的图稿");
  await expect(empty).toHaveText("没有匹配的项目");
  await trash.click();
  await expect(empty).toHaveText("回收站为空");

  available = false;
  await page.reload();
  await open.click();
  await expect(dialog.getByRole("alert")).toContainText("无法连接项目服务");
  await expect(empty).toHaveCount(0);
});

test("opens, soft-deletes, and restores a project from the project menu", async ({ page }) => {
  await page.goto("/app");
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
