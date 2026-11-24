import { expect, test, type Page } from "@playwright/test";
import type { FigureDiscussionReply, FigureDiscussionRequest, FigureDocumentV1, FigureReading } from "@panelstudio/contracts";

const firstWish = "我有一堆图，想做 Fig. 2，不知道该放哪几张。";
const focusWish = "我想重点讲两种方法的一致性";
const firstSummary = "先看总体轨迹，再看方法对照和采样日。";
const focusSummary = "用散点图呈现两种方法的一致性，保留采样日对照。";
const suggestedReason = "按状态分布可在补充图展开。";

const files = [
  [480, 320, "Trajectory overview"],
  [480, 320, "Pseudotime map"],
  [460, 340, "Method A vs Method B"],
  [480, 320, "Method A by state"],
  [480, 320, "Method B by state"],
  [760, 190, "Method A by sampling day"],
  [760, 190, "Method B by sampling day"],
  [480, 320, "Sample counts"],
] as const;

function readingFixture() {
  return files.map(([width, height, label], index) => ({
    name: `scan_${index + 1}.svg`,
    mimeType: "image/svg+xml",
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <text x="16" y="24">${label}</text>
      <path d="M 16 32 V ${height - 24} H ${width - 16}" fill="none" stroke="#555"/>
      <circle cx="120" cy="100" r="5" fill="#18478b"/>
    </svg>`),
  }));
}

const action = (page: Page, name: string) => page.locator(`[data-action="${name}"]:visible`);

async function snapshot(page: Page): Promise<{ document: FigureDocumentV1; revision: number; documentHash: string }> {
  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(`/api/v1/projects/${projectId}/document`);
  expect(response.ok()).toBe(true);
  return response.json();
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem("panelstudio.prefs", JSON.stringify({locale:"zh-CN", theme:"light", motion:"off"}));
    localStorage.setItem("panelstudio.visual-reading", "on");
  });
  await page.route("**/api/v1/settings/ai-provider", route => route.fulfill({json:{
    hasSecret:true, configRevision:1, config:{baseUrl:"https://api.deepseek.com", model:"fixture", capabilities:{imageInput:true}},
  }}));
  await page.route("**/figure-readings", async route => {
    const body = route.request().postDataJSON();
    if (!body.vision) return route.continue();
    const local = await route.fetch({postData:{...body, vision:false, configRevision:undefined}});
    const {items} = await local.json() as {items: FigureReading[]};
    return route.fulfill({json:{items:items.map(item => ({...item, source:"vision", conflict:null}))}});
  });
});

async function draftFigure(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("use-image-model").filter({visible:true})).toBeChecked();
  await page.locator(".opening-chat input[type=file]").setInputFiles(readingFixture());
  await page.getByTestId("start-brief").fill(firstWish);
  await action(page, "start-send").click();
}

async function changeFocus(page: Page) {
  await page.getByTestId("wish-input").fill(focusWish);
  await action(page, "wish-send").click();
}

test("a new scientific focus grows its evidence, keeps the paired comparison and undoes as one edit", async ({page}) => {
  let mainAssetIds: string[] = [];
  const discussions: FigureDiscussionRequest[] = [];
  await page.route("**/figure-discussion", route => {
    const body = route.request().postDataJSON() as FigureDiscussionRequest;
    discussions.push(body);
    const initial = discussions.length === 1;
    if (initial) mainAssetIds = body.assets.slice(0, 7).map(asset => asset.id);
    const [a,b,c,d,e,f,g] = mainAssetIds as [string,string,string,string,string,string,string];
    const supplement = body.assets.find(asset => !mainAssetIds.includes(asset.id));
    const plan: FigureDiscussionReply = {
      kind:"proposal",
      reply:initial ? firstSummary : focusSummary,
      primaryId:initial ? a : c,
      picks:mainAssetIds.map((id, index) => ({id, reason:files[index]![2]})),
      supplementary:supplement ? [{id:supplement.id, reason:"样本数核对"}] : [],
      rows:initial ? [[a,b],[c,d,e],[f,g]] : [[a,b],[c],[d,e],[f],[g]],
      ...(!initial ? {suggestedSupplementary:[{id:d, reason:suggestedReason}]} : {}),
    };
    return route.fulfill({json:plan});
  });

  await draftFigure(page);
  const curation = action(page, "show-curation");
  await expect(curation).toHaveText("主图 7 · 补充图 1");
  await expect(page.getByTestId("wish-workbench")).toContainText(firstSummary);
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  expect(discussions).toHaveLength(1);
  expect(discussions[0]).toMatchObject({curation:{allowQuestion:true}, thumbnails:true, turns:[firstWish]});
  const first = await snapshot(page);
  const [, , c, , , f, g] = first.document.panelOrder as [string,string,string,string,string,string,string];
  const beforeC = first.document.panels[c]!.frameMm;

  await changeFocus(page);
  await expect.poll(() => discussions.length).toBe(2);
  const revisionRequest = discussions[1]!;
  expect(revisionRequest.curation).toEqual({allowQuestion:false, focusRevision:true});
  expect(revisionRequest.thumbnails).toBe(true);
  expect(revisionRequest.turns.at(-1)).toBe(focusWish);
  expect(revisionRequest.assets.filter(asset => asset.selected).map(asset => asset.id).sort()).toEqual([...mainAssetIds].sort());

  const feedback = page.getByTestId("wish-edit-feedback");
  await expect(feedback).toBeVisible();
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.revision).toBe(first.revision + 1);
  expect(after.document.canvas.widthMm).toBe(first.document.canvas.widthMm);
  expect([...after.document.panelOrder].sort()).toEqual([...first.document.panelOrder].sort());
  expect(after.document.panelOrder.map(id => after.document.panels[id]!.assetId).sort()).toEqual([...mainAssetIds].sort());
  expect(after.document.curation?.supplementary).toEqual(first.document.curation?.supplementary);
  expect(after.document.panels[c]!.frameMm.width).toBeGreaterThan(beforeC.width * 1.2);
  const frameF = after.document.panels[f]!.frameMm;
  const frameG = after.document.panels[g]!.frameMm;
  expect(after.document.panelOrder.indexOf(g)).toBe(after.document.panelOrder.indexOf(f) + 1);
  expect(frameF.width).toBeCloseTo(frameG.width, 2);
  expect(frameF.width).toBeGreaterThanOrEqual(first.document.panels[f]!.frameMm.width * 0.9);
  if (Math.abs(frameF.y - frameG.y) < 0.01) {
    expect(frameG.x).toBeGreaterThan(frameF.x + frameF.width);
  } else {
    expect(frameG.x).toBeCloseTo(frameF.x, 2);
    expect(frameG.y).toBeGreaterThan(frameF.y + frameF.height);
  }

  const locate = feedback.getByRole("button", {name:"定位面板 C"});
  await expect(locate).toBeVisible();
  await expect(feedback).toContainText(/尺寸 .+ → .+ mm/);
  await locate.click();
  await expect(page.locator(`[data-panel-id="${c}"]`)).toHaveAttribute("data-selected", "true");
  await expect(curation).toHaveText("主图 7 · 补充图 1");
  await curation.click();
  const review = page.getByRole("dialog", {name:"选图结果"});
  await expect(review).toContainText(focusSummary);
  await expect(review.locator(`[data-curation-suggestion="${mainAssetIds[3]}"]`)).toContainText(suggestedReason);
  await expect(review.locator(`[data-curation-main="${mainAssetIds[3]}"]`)).toBeVisible();
  await review.getByRole("button", {name:"关闭"}).click();
  await feedback.getByRole("button", {name:"撤销", exact:true}).click();
  await expect(feedback).toHaveCount(0);
  expect((await snapshot(page)).documentHash).toBe(first.documentHash);
});

test("adds a supplementary figure as the focus only after the author confirms", async ({page}) => {
  const question = "补充图里有一张散点图直接比较两种方法。把它放进正文吗？";
  const accept = "把散点图加进正文";
  const keep = "保留作补充材料";
  const reason = "散点图直接比较了两种方法的结果。";
  let scatterId = "";
  let sampleCountId = "";
  const discussions: FigureDiscussionRequest[] = [];
  await page.route("**/figure-discussion", route => {
    const body = route.request().postDataJSON() as FigureDiscussionRequest;
    discussions.push(body);
    if (discussions.length === 1) {
      const ids = body.assets.map(asset => asset.id);
      const [overview, map, scatter, firstState, secondState, firstDay, secondDay, counts] = ids as
        [string,string,string,string,string,string,string,string];
      scatterId = scatter;
      sampleCountId = counts;
      const rows = [[overview,map],[firstState,secondState],[firstDay,secondDay]];
      const plan: FigureDiscussionReply = {
        kind:"proposal",
        reply:firstSummary,
        primaryId:overview,
        rows,
        picks:rows.flat().map(id => ({id, reason:files[ids.indexOf(id)]![2]})),
        supplementary:[{id:scatter, reason}, {id:counts, reason:"样本数核对"}],
      };
      return route.fulfill({json:plan});
    }
    const choice: FigureDiscussionReply = {
      kind:"question", reply:question, picks:[], rows:[], promotion:{id:scatterId, question, accept, keep, reason},
    };
    return route.fulfill({json:choice});
  });

  await draftFigure(page);
  const curation = action(page, "show-curation");
  await expect(curation).toHaveText("主图 6 · 补充图 2");
  const first = await snapshot(page);
  await changeFocus(page);
  const card = page.getByTestId("question-card");
  await expect(card).toHaveAccessibleName(question);
  await expect(card.getByRole("button", {name:keep, exact:true})).toBeVisible();
  const proposed = await snapshot(page);
  expect(proposed.documentHash).toBe(first.documentHash);
  expect(proposed.revision).toBe(first.revision);
  expect(discussions).toHaveLength(2);
  expect(discussions[1]!.assets.find(asset => asset.id === scatterId)?.selected).toBe(false);

  await card.getByRole("button", {name:keep, exact:true}).click();
  await expect(card).toHaveCount(0);
  await expect(curation).toBeEnabled();
  expect(discussions).toHaveLength(2);
  const kept = await snapshot(page);
  expect(kept.documentHash).toBe(first.documentHash);
  expect(kept.revision).toBe(first.revision);

  await changeFocus(page);
  await expect(card).toHaveAccessibleName(question);
  expect(discussions).toHaveLength(3);
  await card.getByRole("button", {name:accept, exact:true}).click();
  await expect(curation).toHaveText("主图 7 · 补充图 1");
  await expect(card).toHaveCount(0);
  expect(discussions).toHaveLength(3);
  const after = await snapshot(page);
  const added = after.document.panelOrder.find(id => after.document.panels[id]!.assetId === scatterId);
  expect(added).toBeDefined();
  expect(after.revision).toBe(first.revision + 1);
  expect(after.document.layoutSettings.primaryPanelId).toBe(added);
  expect(after.document.panelOrder.filter(id => id !== added)).toEqual(first.document.panelOrder);
  expect(after.document.curation?.supplementary).toEqual([{id:sampleCountId, reason:"样本数核对"}]);

  const feedback = page.getByTestId("wish-edit-feedback");
  await feedback.getByRole("button", {name:"定位面板 G"}).click();
  await expect(page.locator(`[data-panel-id="${added}"]`)).toHaveAttribute("data-selected", "true");
  await feedback.getByRole("button", {name:"撤销", exact:true}).click();
  await expect(curation).toHaveText("主图 6 · 补充图 2");
  expect((await snapshot(page)).documentHash).toBe(first.documentHash);
});
