import { expect, test, type Locator, type Page } from "@playwright/test";
import type { FigureDocumentV1 } from "@panelstudio/contracts";

type Snapshot = { revision: number; documentHash: string; document: FigureDocumentV1 };
test.beforeEach(async ({ page }) => {
  await page.addLocatorHandler(page.getByRole("dialog", { name: /^(排版目标|Figure brief)$/ }), async () => {
    await page.locator('[data-action="skip-publication"]').click();
  });
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ theme: "light", motion: "on", locale: "zh-CN" })));
  await page.goto("/");
  const files = [2, 1, 1.5].map((ratio, i) => ({
    name: `panel-${i + 1}.svg`, mimeType: "image/svg+xml",
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${40 * ratio} 40"><rect width="${40 * ratio}" height="40" fill="#777"/></svg>`),
  }));
  await page.getByTestId("import-input").setInputFiles(files);
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
});

async function snapshot(page: Page): Promise<Snapshot> {
  const id = await page.evaluate(() => localStorage.getItem("panelstudio.projectId"));
  return (await page.request.get(`/api/v1/projects/${id}/document`)).json();
}
async function center(locator: Locator) {
  const r = await locator.boundingBox();
  if (!r) throw new Error("Cannot find the requested canvas item");
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
async function drag(page: Page, locator: Locator, x: number, y: number, cancel = false) {
  const from = await center(locator);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + x, from.y + y, { steps: 6 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
async function committed(page: Page, action: () => Promise<void>, endpoint = "transactions") {
  const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/" + endpoint) && r.request().method() === "POST"), action()]);
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  return snapshot(page);
}

test("drags complete selections and rigid groups once, cancels a gesture, and rejects a lock", async ({ page }) => {
  const root = await snapshot(page);
  const [a, b, c] = root.document.panelOrder as [string, string, string];
  const frame = (id: string) => page.locator(`[data-panel-id="${id}"]`);
  await frame(a).click(); await frame(b).click({ modifiers: ["Shift"] });
  await expect(frame(a)).toHaveAttribute("data-selected", "true");
  await expect(frame(b)).toHaveAttribute("data-selected", "true");
  const moved = await committed(page, () => drag(page, frame(a), 14, 12));
  const displacement = (id: string) => moved.document.panels[id]!.frameMm.x - root.document.panels[id]!.frameMm.x;
  expect(displacement(a)).toBeGreaterThan(0);
  expect(displacement(b)).toBeCloseTo(displacement(a), 5);
  expect(moved.document.panels[c]).toEqual(root.document.panels[c]);
  expect(moved.revision).toBe(root.revision + 1);
  const undone = await committed(page, () => page.locator("[data-action=undo]").click(), "history/undo");
  expect(undone.documentHash).toBe(root.documentHash);
  const grouped = await committed(page, () => page.locator("[data-action=group]").click());
  const groupDrag = await committed(page, () => drag(page, frame(b), 12, 16));
  expect(groupDrag.document.groups).toEqual(grouped.document.groups);
  expect(groupDrag.document.panels[b]!.frameMm.x - groupDrag.document.panels[a]!.frameMm.x)
    .toBeCloseTo(grouped.document.panels[b]!.frameMm.x - grouped.document.panels[a]!.frameMm.x, 5);
  await drag(page, frame(a), 20, 18, true);
  expect((await snapshot(page)).revision).toBe(groupDrag.revision);
  const locked = await committed(page, () => page.locator("[data-action=group-lock]").click());
  await drag(page, frame(b), 14, 20);
  await expect(page.getByTestId("live")).toContainText(/锁/);
  expect((await snapshot(page)).revision).toBe(locked.revision);
});

test("edits only the label baseline, batches nudge keys and keeps lettering automatic after list sorting", async ({ page }) => {
  const root = await snapshot(page);
  const [a, b, c] = root.document.panelOrder as [string, string, string];
  const hit = page.locator(`[data-label-id="${b}"]`);
  const moved = await committed(page, () => drag(page, hit, 12, 9));
  expect(moved.document.panels[b]!.frameMm).toEqual(root.document.panels[b]!.frameMm);
  const before = moved.document.panels[b]!.labelOverrides;
  expect(before.offsetMm).not.toBeNull();
  expect(before.text).toBeNull();
  await page.getByTestId("canvas").focus();
  const nudged = await committed(page, async () => {
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown"); await page.keyboard.press("ArrowRight");
  });
  expect(nudged.revision).toBe(moved.revision + 1);
  expect(nudged.document.panels[b]!.labelOverrides.offsetMm!.x - before.offsetMm!.x).toBeCloseTo(0.2, 6);
  expect(nudged.document.panels[b]!.labelOverrides.offsetMm!.y - before.offsetMm!.y).toBeCloseTo(1, 6);
  await page.locator("[data-action=tab-panels]").click();
  const handle = (id: string) => page.locator(`[data-handle-id="${id}"]`);
  const keyboard = await committed(page, () => handle(b).press("Alt+ArrowUp"));
  expect(keyboard.document).toEqual({ ...nudged.document, panelOrder: [b, a, c] });
  await expect(handle(b)).toBeFocused();
  const target = page.getByTestId("panel-row").nth(2);
  const reordered = await committed(page, () => handle(b).dragTo(target, { targetPosition: { x: 12, y: 38 } }));
  expect(reordered.document).toEqual({ ...nudged.document, panelOrder: [a, c, b] });
  await expect(page.locator(".drop-overlay")).toHaveCount(0);
  await expect(handle(b)).toBeFocused();
  const undone = await committed(page, () => page.locator("[data-action=undo]").click(), "history/undo");
  expect(undone.documentHash).toBe(keyboard.documentHash);
});

test("keeps an empty numeric field and IME Enter from issuing transactions, and commits a color once", async ({ page }) => {
  const root = await snapshot(page);
  const size = page.getByTestId("label-size");
  const value = await size.inputValue();
  await size.fill(""); await size.press("Tab");
  expect(await size.inputValue()).toBe(value);
  await size.fill("11");
  await size.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
  expect((await snapshot(page)).revision).toBe(root.revision);
  await size.press("Escape");
  const color = page.getByRole("textbox", { name: /颜色/ }).first();
  await color.fill("#444444");
  const colored = await committed(page, () => color.press("Tab"));
  expect(colored.revision).toBe(root.revision + 1);
  expect(colored.document.labelStyle.color).toBe("#444444");
});

test("previews the maximum equal width in a custom 100 mm row and keeps both panels editable", async ({ page }) => {
  const initial = await snapshot(page);
  const [a,b,c] = initial.document.panelOrder as [string,string,string];
  await page.locator(`[data-panel-id="${c}"]`).click();
  const base = await committed(page, () => page.keyboard.press("Delete"));
  await page.locator(`[data-panel-id="${a}"]`).click();
  await page.locator(`[data-panel-id="${b}"]`).click({ modifiers:["Shift"] });
  const fields = page.getByTestId("local-row");
  await page.getByTestId("row-sizing").selectOption("equal-width");
  await fields.getByRole("checkbox").check();
  for (const [name, value] of [["左边界", "10"], ["上边界", "10"], ["区域宽度", "100"], ["区域高度","75"]] as const) {
    const input = fields.getByLabel(new RegExp(name));
    await input.fill(value); await input.press("Tab");
  }
  await page.locator("[data-action=selection-row]").click();
  await expect(page.getByTestId("candidate-card")).toHaveCount(1);
  expect((await snapshot(page)).documentHash).toBe(base.documentHash);
  const result = await committed(page, () => page.locator("[data-action=apply-layout]").click());
  const f = result.document.panels[a]!.frameMm, g = result.document.panels[b]!.frameMm;
  expect(f.width).toBeCloseTo(48, 3); expect(g.width).toBeCloseTo(48, 3);
  expect(f.height).toBeCloseTo(24, 3); expect(g.height).toBeCloseTo(48, 3);
  expect(f.y).toBeCloseTo(g.y, 5);
  expect(result.document.stackOrder).toEqual(base.document.stackOrder);
  expect(result.document.panels[b]!.labelOverrides).toEqual(base.document.panels[b]!.labelOverrides);
});

test("Shift-marquee includes complete groups, adds to the selection and cancels without a revision", async ({ page }) => {
  const initial = await snapshot(page);
  const [a,b,c] = initial.document.panelOrder as [string,string,string];
  const frame = (id: string) => page.locator(`[data-panel-id="${id}"]`);
  await frame(a).click(); await frame(b).click({ modifiers:["Shift"] });
  const base = await committed(page, () => page.locator("[data-action=group]").click());
  await frame(c).click();
  const r = await frame(a).boundingBox();
  if (!r) throw Error("Panel A unavailable");
  const paper = await page.locator(".paper").boundingBox();
  if (!paper) throw Error("Artboard unavailable");
  const from = { x:r.x + r.width / 2, y:Math.min(paper.y + paper.height - 8, r.y + r.height + 10) };
  await page.keyboard.down("Shift");
  for (const cancel of [true, false]) {
    await page.mouse.move(from.x,from.y); await page.mouse.down();
    await page.mouse.move(from.x+5,r.y+r.height-8,{steps:5});
    await expect(page.getByTestId("marquee")).toBeVisible();
    for (const id of [a,b,c]) await expect(frame(id)).toHaveAttribute("data-selected","true");
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByTestId("marquee")).toHaveCount(0);
    await expect(frame(a)).toHaveAttribute("data-selected", cancel ? "false" : "true");
    await expect(frame(c)).toHaveAttribute("data-selected", "true");
  }
  await page.keyboard.up("Shift");
  expect((await snapshot(page)).revision).toBe(base.revision);
});
