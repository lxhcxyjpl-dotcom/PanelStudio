import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { FigureDocumentV1 } from "@panelstudio/contracts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const base = path.join(root, "examples/showcase/assets");
const action = (p: Page, n: string) => p.locator('[data-action="' + n + '"]:visible');
function image(name: string, source: string) {
  return {
    name,
    mimeType: name.endsWith(".svg") ? "image/svg+xml" : "image/png",
    buffer: readFileSync(path.join(base, source)),
  };
}
const triplet = [
  image("control-micrograph.png", "microscopy-blue.png"),
  image("treated-micrograph.png", "microscopy-green.png"),
  image("quantification.svg", "experimental-bars.svg"),
];
async function start(page: Page, words: string, files: typeof triplet) {
  await page.goto("/");
  if (words) await page.getByTestId("start-brief").filter({ visible: true }).fill(words);
  const pick = page.waitForEvent("filechooser");
  await action(page, "empty-import").click();
  await (await pick).setFiles(files);
  await action(page,"start-send").click();
  await expect(page).toHaveURL(/\/app\/[a-f0-9-]+$/);
  await expect(page.getByTestId("wish-input")).toBeVisible();
}
function say(page: Page, text: string) {
  return page
    .getByTestId("wish-input")
    .fill(text)
    .then(() => action(page, "wish-send").click());
}
async function snapshot(
  page: Page,
): Promise<{ document: FigureDocumentV1; revision: number; documentHash: string }> {
  const res = await page.request.get(
    "/api/v1/projects/" + new URL(page.url()).pathname.split("/").at(-1) + "/document",
  );
  expect(res.ok()).toBe(true);
  return res.json();
}
test.beforeEach(async ({ page }) => {
  // These cases exercise local use even if another suite configured a test provider.
  await page.addInitScript(()=>localStorage.setItem("panelstudio.visual-reading","off"));
  await page.addInitScript(() =>
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ locale: "zh-CN", theme: "light", motion: "on" }),
    ),
  );
});

test("an explicit wish goes from personal images to an editable 85 mm figure", async ({ page }) => {
  await start(page, "两张显微图并排，定量图放在下面，整张宽 85 mm", triplet);
  await expect.poll(async () => (await snapshot(page)).document.canvas.widthMm).toBe(85);
  const { document: d } = await snapshot(page);
  const [a, b, c] = d.panelOrder.map((id) => d.panels[id]!.frameMm);
  expect(a!.y).toBeCloseTo(b!.y, 5);
  expect(c!.y).toBeGreaterThan(a!.y + a!.height);
  await say(page, "把 B 缩小 10%");
  const [aId, bId, cId] = d.panelOrder;
  await expect
    .poll(async () => (await snapshot(page)).document.panels[d.panelOrder[1]!]!.frameMm.width)
    .toBeCloseTo(b!.width * 0.9, 5);
  const { document: edited } = await snapshot(page);
  const receipt = page.getByTestId("wish-edit-feedback");
  const size = ({ width, height }: { width: number; height: number }) =>
    [width, height].map(n => Math.round(n * 100) / 100).join(" × ");
  await expect(receipt).toContainText(`尺寸 ${size(b!)} → ${size(edited.panels[bId!]!.frameMm)} mm`);
  expect(edited.panels[aId!]).toEqual(d.panels[aId!]);
  expect(edited.panels[cId!]).toEqual(d.panels[cId!]);
  await expect(page.locator('[data-wish-changed="true"]')).toHaveAttribute("data-panel-id", bId!);
  const canvas = page.getByTestId("canvas");
  await canvas.dispatchEvent("wheel", { deltaX: 2400, deltaY: 1600, cancelable: true });
  const bPanel = page.locator(`[data-panel-id="${bId}"]`);
  const withinCanvas = async () => {
    const [panel, stage] = await Promise.all([bPanel.boundingBox(), canvas.boundingBox()]);
    return Boolean(panel && stage && panel.x >= stage.x && panel.y >= stage.y &&
      panel.x + panel.width <= stage.x + stage.width && panel.y + panel.height <= stage.y + stage.height);
  };
  await expect.poll(withinCanvas).toBe(false);
  await receipt.getByRole("button", { name: "定位面板 B" }).click();
  await expect(bPanel).toHaveAttribute("data-selected", "true");
  await expect.poll(withinCanvas).toBe(true);
  await receipt.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(receipt).toHaveCount(0);
  await expect(page.getByTestId("wish-workbench")).toContainText("已撤销");
  expect((await snapshot(page)).document).toEqual(d);

  await say(page, "把 B 缩小 10%");
  await receipt.getByRole("button", { name: "定位面板 B" }).click();
  const beforeNudge = await snapshot(page);
  await canvas.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await snapshot(page)).revision).toBe(beforeNudge.revision + 1);
  await expect(action(page,"wish-undo-edit")).toHaveCount(0);
  expect((await snapshot(page)).document.panels[bId!]!.frameMm.x).toBeLessThan(beforeNudge.document.panels[bId!]!.frameMm.x);
});

test("an undecided author receives a draft and can volunteer reusable publication details", async ({ page }) => {
  await start(page, "我不知道该怎么排", triplet);
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  await say(page, "目标期刊：PLOS ONE，方向：组织成像，比较两组图像");
  await expect.poll(async () => (await snapshot(page)).document.publicationContext?.journal).toBe("PLOS ONE");
  const { document: d } = await snapshot(page);
  expect(d.publicationContext).toMatchObject({
    journal: "PLOS ONE",
    field: "组织成像",
    preference: "comparison",
  });
  await page.reload();
  await expect(page.getByTestId("wish-input")).toBeVisible();
  expect((await snapshot(page)).document.publicationContext).toEqual(d.publicationContext);
  await start(page, "", triplet.slice(0, 2));
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  await expect.poll(async () => (await snapshot(page)).document.publicationContext?.journal).toBe("PLOS ONE");
  expect((await snapshot(page)).document.publicationContext?.message).toBe("");
});

test("attaching ten images without a brief arranges every image and skips fixed questions", async ({ page }) => {
  const files = Array.from({ length: 10 }, (_, index) => {
    const source = triplet[index % triplet.length]!;
    return { ...source, name: `${index + 1}-${source.name}` };
  });
  await start(page, "", files);
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  const { document } = await snapshot(page);
  expect(document.panelOrder).toHaveLength(files.length);
  expect(document.panelOrder.map(id => document.panels[id]!.name).sort()).toEqual(files.map(file => file.name).sort());
  await page.reload();
  await expect(page.getByTestId("wish-input")).toBeVisible();
  expect((await snapshot(page)).document).toEqual(document);
});

test("an unrecognized first request leaves a working automatic draft action", async ({ page }) => {
  await start(page, "请把这三张科研数据图按上传顺序排成一张论文 Fig. 2，标成 A、B、C。", triplet);
  const workbench = page.getByTestId("wish-workbench");
  await expect(workbench).toContainText("图片已导入，尚未完成排版。");
  await expect(page.locator(".project-name")).toHaveValue("Fig. 2");
  await expect(page.getByTestId("wish-input")).toHaveValue("");
  const before = await snapshot(page);
  const auto = action(page, "wish-draft");
  await expect(auto).toHaveText("自动排一版");
  await auto.click();
  await expect(workbench).toContainText("第一稿已排好");
  const after = await snapshot(page);
  expect(after.revision).toBeGreaterThan(before.revision);
  expect(after.document.panelOrder).toEqual(before.document.panelOrder);
  expect(after.document.canvas.heightMm).toBeLessThan(before.document.canvas.heightMm);
});

test("a named pair keeps the artboard and other panel, and an oversized resize gives a usable choice", async ({ page }) => {
  await start(page, "两张显微图并排，定量图放在下面，整张宽 85 mm", triplet);
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  const before = await snapshot(page);
  const [a, b, c] = before.document.panelOrder;
  await say(page, "B 和 A 并排，其他保持不变");
  const feedback = page.getByTestId("wish-edit-feedback");
  await expect(feedback).toBeVisible();
  const arranged = await snapshot(page);
  expect(arranged.document.canvas).toEqual(before.document.canvas);
  expect(arranged.document.panels[c!]).toEqual(before.document.panels[c!]);
  expect(arranged.document.panels[b!]!.frameMm.x).toBeLessThan(arranged.document.panels[a!]!.frameMm.x);

  await say(page, "把 B 的宽度改为 200 mm");
  const card = page.getByTestId("question-card");
  await expect(card).toContainText("B 调整后会超出画板");
  expect((await snapshot(page)).documentHash).toBe(arranged.documentHash);
  await card.getByRole("button", { name: "把 B 缩小 10%" }).click();
  await expect(feedback).toBeVisible();
  const smaller = await snapshot(page);
  expect(smaller.document.panels[b!]!.frameMm.width).toBeCloseTo(arranged.document.panels[b!]!.frameMm.width * 0.9, 5);
  await feedback.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByTestId("wish-workbench")).toContainText("已撤销");
  await page.locator(`[data-panel-id="${b}"]`).click();
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await snapshot(page)).revision).toBe(smaller.revision + 2);
  await expect(page.getByTestId("wish-workbench")).not.toContainText("已撤销");
});

test("a Fig. 2 submission discussion chooses from ten images, revises, edits manually and exports", async ({
  page,
}, info) => {
  const candidates = [
    ...triplet,
    image("workflow.svg", "experimental.svg"),
    image("blot.png", "experimental-bands.png"),
    image("overview.png", "microscopy-merged.png"),
    image("markers.svg", "molecular.svg"),
    image("atlas.svg", "single-cell.svg"),
    image("detail-E.svg", "panel-e.svg"),
    image("detail-F.svg", "panel-f.svg"),
  ];
  await start(page, "我有一些候选图，帮我选图", candidates);
  await expect(page.locator("[data-asset-choice]")).toHaveCount(10);
  await expect(page.locator(".panel-frame")).toHaveCount(0);
  await say(page, "投 PLOS ONE，方向：组织成像，Fig. 2 想比较对照和处理的显微图，并展示定量");
  const checked = page.locator('[data-asset-choice][aria-pressed="true"]');
  await expect(checked).toHaveCount(3);
  await expect(checked.nth(2)).toContainText("quantification.svg");
  await say(page, "加上 #4");
  await expect(checked).toHaveCount(4);
  await say(page, "#4 留给补充，去掉 #4");
  await expect(checked).toHaveCount(3);
  await page.reload();
  await expect(checked).toHaveCount(3);
  await page.screenshot({ path: info.outputPath("01-选图讨论.png") });
  await say(page, "两张显微图并排，定量图放在下面，整张宽 85 mm");
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  const first = await snapshot(page);
  expect(first.document.canvas.widthMm).toBe(85);
  expect(first.document.publicationContext?.journal).toBe("PLOS ONE");
  const [a, b, c] = first.document.panelOrder as [string, string, string];
  expect(first.document.panels[b]!.frameMm.y).toBeCloseTo(first.document.panels[a]!.frameMm.y, 5);
  expect(first.document.panels[c]!.frameMm.y).toBeGreaterThan(first.document.panels[a]!.frameMm.y);
  await page.screenshot({ path: info.outputPath("02-投稿第一稿.png") });
  await say(page, "把 B 缩小 10%");
  await expect.poll(async () => (await snapshot(page)).revision).toBe(first.revision + 1);
  const afterSpeech = await snapshot(page);
  expect(afterSpeech.document.panels[a]).toEqual(first.document.panels[a]);
  const frame = page.locator('[data-panel-id="' + b + '"]');
  const box = await frame.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(x - 8, y + 5, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await snapshot(page)).revision).toBe(afterSpeech.revision + 1);
  const manual = await snapshot(page);
  expect(manual.document.panels[b]!.frameMm.x).not.toEqual(afterSpeech.document.panels[b]!.frameMm.x);
  await say(page, "把 C 缩小 10%");
  await expect.poll(async () => (await snapshot(page)).revision).toBe(manual.revision + 1);
  const final = await snapshot(page);
  expect(final.document.panels[b]).toEqual(manual.document.panels[b]);
  await page.reload();
  await expect(frame).toBeVisible();
  expect((await snapshot(page)).documentHash).toBe(final.documentHash);
  await action(page, "export").click();
  const download = page.waitForEvent("download");
  await action(page, "export-svg").click();
  const svg = info.outputPath("Fig2-85mm.svg");
  await (await download).saveAs(svg);
  const xml = readFileSync(svg, "utf8");
  expect(xml).toContain('width="85mm"');
  expect(xml).toContain("<text");
  expect(xml).toContain("<image");
  const lib = await page.request.get(
    "/api/v1/projects/" + new URL(page.url()).pathname.split("/").at(-1) + "/assets?limit=50",
  );
  const { items } = await lib.json();
  expect(items).toHaveLength(10);
  writeFileSync(
    info.outputPath("Fig2-case.json"),
    JSON.stringify(
      {
        source: "synthetic submission rehearsal",
        inputs: candidates.map((f) => f.name),
        first: first.document,
        afterSpeech: afterSpeech.document.panels[b],
        afterDrag: manual.document.panels[b],
        final: final.document,
        libraryAssets: items.length,
        hash: final.documentHash,
      },
      null,
      2,
    ),
  );
});

test("lets the author accept a shortlist in their own words and continue without a second form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, "帮我选图", triplet);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await say(page, "保留对照和定量");
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(2);
  await say(page, "就用这两张排一版");
  await expect(page.locator(".panel-frame")).toHaveCount(2);
  const first = await snapshot(page);
  await action(page, "undo").click();
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(2);
  await say(page, "就用这两张排一版");
  await expect(page.locator(".panel-frame")).toHaveCount(2);
  const redrafted = await snapshot(page);
  await say(page, "目标期刊：PLOS ONE，方向：成像");
  await expect.poll(async () => (await snapshot(page)).document.publicationContext?.field).toBe("成像");
  expect((await snapshot(page)).document.panels).toEqual(redrafted.document.panels);
  expect(first.document.panelOrder.length).toBe(redrafted.document.panelOrder.length);
});

test("understands a width and named arrangement after the files have already been uploaded", async ({
  page,
}) => {
  await start(page, "", triplet);
  await say(page, "Place the two micrographs side by side, with quantification below, at 85 mm wide");
  await expect.poll(async () => (await snapshot(page)).document.canvas.widthMm).toBe(85);
  const { document: d } = await snapshot(page);
  const [a, b, c] = d.panelOrder.map((id) => d.panels[id]!.frameMm);
  expect(a!.y).toBeCloseTo(b!.y, 5);
  expect(c!.y).toBeGreaterThan(a!.y + a!.height);
});

test("tries the example wish in the editable workspace", async ({ page }) => {
  await page.goto("/");
  await action(page, "wish-demo").click();
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  const original = await snapshot(page);
  await say(page, "不要放大 B");
  await expect(page.getByTestId("wish-input")).toHaveValue("不要放大 B");
  expect((await snapshot(page)).documentHash).toBe(original.documentHash);
});

test("replaces B with a new same-name file in one undoable revision", async ({ page }) => {
  await start(page, "A 和 B 并排", triplet.slice(0, 2));
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  const original = await snapshot(page),
    [a, b] = original.document.panelOrder as [string, string];
  const picker = page.waitForEvent("filechooser");
  await say(page, "把 B 换成新版，位置和编号照旧");
  await (await picker).setFiles(image("treated-micrograph.png", "microscopy-merged.png"));
  await expect.poll(async () => (await snapshot(page)).revision).toBe(original.revision + 1);
  const revised = await snapshot(page);
  expect(revised.document.panelOrder).toEqual([a, b]);
  expect(revised.document.panels[a]).toEqual(original.document.panels[a]);
  expect(revised.document.panels[b]!.assetId).not.toBe(original.document.panels[b]!.assetId);
  expect(revised.document.panels[b]!.frameMm).toEqual(original.document.panels[b]!.frameMm);
  await action(page, "undo").click();
  await expect.poll(async () => (await snapshot(page)).documentHash).toBe(original.documentHash);
  const second = page.waitForEvent("filechooser");
  await say(page, "把 B 换成新版");
  await (await second).setFiles(triplet[2]!);
  await expect(action(page, "confirm-swap")).toBeVisible();
  await action(page, "cancel-swap").click();
  expect((await snapshot(page)).documentHash).toBe(original.documentHash);
});
