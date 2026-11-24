import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { FigureDocumentV1 } from "@panelstudio/contracts";

const action = (page: Page, name: string) => page.locator(`[data-action="${name}"]`);

async function openMicroscopy(page: Page) {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ locale: "zh-CN", motion: "off" })));
  await page.goto("/app");
  const chooser = page.waitForEvent("filechooser");
  await action(page, "start-open-package").click();
  await (await chooser).setFiles(fileURLToPath(new URL("../public/showcase/microscopy.figurezip", import.meta.url)));
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  const projectId = page.url().split("/").at(-1);
  await expect(action(page, "width-180")).toHaveAttribute("aria-pressed", "true");
  const snapshot = async (): Promise<{ revision: number; document: FigureDocumentV1; documentHash: string }> => {
    const response = await page.request.get(`/api/v1/projects/${projectId}/document`);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  return snapshot;
}

test("previews a single-column revision, exports the requested physical width and undoes the entire reflow", async ({ page }, info) => {
  const snapshot = await openMicroscopy(page);
  const original = await snapshot();
  await action(page, "width-85").click();
  await expect(page.getByRole("alert")).toContainText("内容超出画板 (B, C)");
  await page.screenshot({ path: info.outputPath("width-conflict.png") });
  await expect(action(page, "width-180")).toHaveAttribute("aria-pressed", "true");
  await action(page, "preview-canvas-width").click();
  const card = page.getByTestId("candidate-card").first();
  await expect(card).toContainText("85 ×");
  await expect(action(page, "apply-layout")).toBeInViewport();
  await expect(card.locator("img")).toBeVisible();
  await page.screenshot({ path: info.outputPath("width-preview.png") });
  await page.getByTestId("candidate-card").last().scrollIntoViewIfNeeded();
  await expect(action(page, "apply-layout")).toBeInViewport();
  expect((await snapshot()).revision).toBe(original.revision);
  await action(page, "cancel-layout").click();
  await expect(action(page, "width-180")).toHaveAttribute("aria-pressed", "true");
  expect((await snapshot()).documentHash).toBe(original.documentHash);

  const width = page.getByRole("textbox", { name: "宽度 (mm)", exact: true });
  await width.fill("85");
  await width.press("Enter");
  await expect(width).toHaveValue("180");
  await action(page, "preview-canvas-width").click();
  await expect(card).toContainText("85 ×");
  await action(page, "apply-layout").click();
  await expect(action(page, "width-85")).toHaveAttribute("aria-pressed", "true");
  const updated = await snapshot();
  expect(updated.revision).toBe(original.revision + 1);
  expect(updated.document.canvas.widthMm).toBe(85);
  expect(updated.document.panelOrder).toEqual(original.document.panelOrder);
  expect(updated.document.labelStyle).toEqual(original.document.labelStyle);
  for (const id of updated.document.panelOrder) {
    const frameMm = updated.document.panels[id]!.frameMm;
    expect(updated.document.panels[id]).toEqual({ ...original.document.panels[id], frameMm });
    expect(frameMm.x + frameMm.width).toBeLessThanOrEqual(85.0001);
  }
  await page.getByTestId("export-button").click();
  const [file] = await Promise.all([page.waitForEvent("download"), action(page, "export-svg").click()]);
  const target = info.outputPath("microscopy-85mm.svg");
  await file.saveAs(target);
  expect(await readFile(target, "utf8")).toMatch(/<svg\b[^>]*\bwidth="85mm"/);
  await action(page, "export-close").click();
  await action(page, "undo").click();
  await expect(action(page, "width-180")).toHaveAttribute("aria-pressed", "true");
  expect((await snapshot()).documentHash).toBe(original.documentHash);
});

test("explains a locked overflowing panel and leaves it in place", async ({ page }) => {
  const snapshot = await openMicroscopy(page);
  await action(page, "tab-panels").click();
  const row = page.getByTestId("panel-row").last();
  await row.getByRole("button", { name: "锁定", exact: true }).click();
  await expect(row.getByRole("button", { name: "解锁", exact: true })).toBeVisible();
  const locked = await snapshot();
  await action(page, "width-85").click();
  await expect(page.getByText("请先解锁超出边界的面板或所属编组（C）。")).toBeVisible();
  await expect(action(page, "preview-canvas-width")).toHaveCount(0);
  expect((await snapshot()).document).toEqual(locked.document);
});

test("a failed target width cannot apply a previous layout", async ({ page }) => {
  const snapshot = await openMicroscopy(page);
  const original = await snapshot();
  await page.locator("[data-action=layout-tools]").click();
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toContainText("180 ×");
  await action(page, "manual-edit").click();
  const width = page.getByRole("textbox", { name: "宽度 (mm)", exact: true });
  await width.fill("7");
  await width.press("Enter");
  await action(page, "preview-canvas-width").click();
  await expect(page.getByText(/布局约束无解/).first()).toBeVisible();
  await expect(page.getByTestId("candidate-card")).toHaveCount(0);
  await expect(action(page, "apply-layout")).toHaveCount(0);
  await expect(action(page, "cancel-layout")).toHaveText("返回编辑");
  expect((await snapshot()).documentHash).toBe(original.documentHash);
});
