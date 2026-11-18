import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { test, expect } from "@playwright/test";
import { MM_PER_INCH, PNG_DPI_OPTIONS, pngPixelsFromMm } from "@panelstudio/contracts";

test("checks the saved microscopy panels and downloads only the selected export options", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ locale: "zh-CN" })));
  await page.goto("/app");
  const sample = fileURLToPath(new URL("../public/showcase/microscopy.figurezip", import.meta.url));
  await page.locator("#package-input").setInputFiles(sample);
  const title = page.getByRole("textbox", { name: "名称", exact: true });
  await expect(title).toHaveValue(/microscopy/);
  await title.fill("显微成像终稿");
  await title.press("Enter");
  await expect(title).toHaveValue("显微成像终稿");
  const action = (name: string) => page.locator('[data-action="' + name + '"]');
  await page.getByTestId("export-button").click();
  const quality = page.getByTestId("export-quality");
  await expect(quality).toContainText("目标 300 PPI");
  await expect(quality.locator("li")).toHaveCount(3);
  await expect(quality.locator("li").first()).toContainText("A · microscopy-blue.png");
  await expect(quality.locator("li").first()).toContainText("111.5 PPI · 低于目标");
  const again = action("download-again");
  const download = async (button: string, filename: string, label = button) => {
    const [file] = await Promise.all([page.waitForEvent("download"), action(button).click()]);
    expect(file.suggestedFilename()).toBe(filename);
    const dest = info.outputPath(label + "-" + filename);
    await file.saveAs(dest);
    await expect(again).toBeVisible();
    return readFileSync(dest);
  };
  expect((await download("export-svg", "显微成像终稿.svg")).toString()).toContain('width="180mm"');
  await action("format-png").click();
  await expect(again).toHaveCount(0);
  for (const dpi of PNG_DPI_OPTIONS) {
    const selector = page.getByRole("combobox", { name: "整图 PNG 输出分辨率" });
    await selector.selectOption(String(dpi));
    await expect(again).toHaveCount(0);
    const png = await download("export-png", "显微成像终稿.png", String(dpi));
    expect(png.readUInt32BE(16)).toBe(pngPixelsFromMm(180, dpi));
    const density = Math.round(1000 * dpi / MM_PER_INCH);
    let physicalChunks = 0;
    for (let offset = 8; offset + 12 <= png.length;) {
      const length = png.readUInt32BE(offset);
      if (png.toString("ascii", offset + 4, offset + 8) === "pHYs") {
        physicalChunks++;
        expect(length).toBe(9);
        expect(png.readUInt32BE(offset + 8)).toBe(density);
        expect(png.readUInt32BE(offset + 12)).toBe(density);
        expect(png[offset + 16]).toBe(1);
        expect(png.readUInt32BE(offset + 17)).toBe(crc32(png.subarray(offset + 4, offset + 17)));
      }
      offset += length + 12;
    }
    expect(physicalChunks).toBe(1);
    await expect(quality).toContainText("111.5 PPI");
  }
  await action("format-svg").click();
  await expect(again).toHaveCount(0);
  await download("export-svg", "显微成像终稿.svg");
  const metadata = page.getByRole("checkbox", { name: /修订元数据/ });
  await metadata.uncheck();
  await expect(again).toHaveCount(0);

  // Hold the export request while the user closes and reopens the dialog.
  await action("format-png").click();
  const selector = page.getByRole("combobox", { name: "整图 PNG 输出分辨率" });
  await selector.selectOption("150");
  let resume!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  await page.route("**/exports", async route => { await paused; await route.continue(); });
  const request = page.waitForRequest("**/exports");
  await action("export-png").click();
  await request;
  try {
    await action("export-close").click();
    await page.getByTestId("export-button").click();
    await expect(selector).toHaveValue("150");
    await expect(selector).toBeDisabled();
    await expect(action("format-svg")).toBeDisabled();
    await expect(page.getByTestId("export-phase")).toBeVisible();
  } finally {
    resume();
  }
  await expect(again).toBeVisible();
  await action("format-svg").click();
  await expect(again).toHaveCount(0);
});
