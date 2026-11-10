import { expect, test, type Page } from "@playwright/test";
import type { FigureDocumentV1 } from "@panelstudio/contracts";

const action = (p: Page, name: string) => p.locator('[data-action="' + name + '"]');
const image = (name: string, inner: string) => ({name, mimeType:"image/svg+xml",
  buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">' + inner + '</svg>')});
const reference = image("three-regions.svg", '<g fill="white" stroke="black" stroke-width="3"><rect x="3" y="3" width="140" height="108"/><rect x="154" y="3" width="242" height="232"/><rect x="3" y="122" width="140" height="113"/></g>');
async function snapshot(page: Page): Promise<{document:FigureDocumentV1;documentHash:string;revision:number}> {
  const id = await page.evaluate(() => localStorage.getItem("panelstudio.projectId"));
  return (await page.request.get("/api/v1/projects/" + id + "/document")).json();
}
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs",JSON.stringify({locale:"zh-CN",motion:"off"})));
  await page.goto("/");
  await page.getByTestId("import-input").setInputFiles([1,2,3].map(i => image(i+".svg",'<rect width="400" height="240" fill="#426c89"/>')));
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await action(page,"guided-layout").click();
});
test("reference only and combined input preview, commit, undo and export via the normal editor",async ({page}) => {
  const base = await snapshot(page);
  const traffic: string[] = [];
  page.on("request", r => { if (r.method()==="POST") traffic.push(r.url()); });
  await page.getByTestId("reference-file").setInputFiles(reference);
  await expect(page.locator(".guide-box")).toHaveCount(3);
  await expect(action(page,"generate-guided")).toBeEnabled();
  await expect(page.locator(".guide-regions select").nth(1)).toHaveValue("panel:"+base.document.panelOrder[1]);
  expect(traffic.some((u) => u.includes("/assets") || u.includes("/ai-layouts"))).toBe(false);
  const response = page.waitForResponse(r => r.url().endsWith("/layout-candidates") && r.request().method()==="POST");
  await action(page,"generate-guided").click();
  const first = await response;
  expect(first.ok()).toBe(true);
  const body = first.request().postDataJSON().request;
  expect(body.referenceSlots).toHaveLength(3); expect(body.preferences).toEqual({});
  expect(JSON.stringify(body)).not.toContain("<svg");
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  expect((await snapshot(page)).documentHash).toBe(base.documentHash);
  await action(page,"guided-layout").click();
  await page.getByTestId("guide-words").fill("突出 B，A 和 C 上下排列，留白多一点");
  await expect(page.getByLabel("面板间距 (mm)",{exact:true})).toHaveValue("6");
  await action(page,"generate-guided").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button",{name:"使用此布局"}).click();
  await expect.poll(async ()=>(await snapshot(page)).revision).toBe(base.revision+1);
  const applied = (await snapshot(page)).document;
  expect(applied.panelOrder).toEqual(base.document.panelOrder);
  expect(applied.layoutSettings.primaryPanelId).toBe(applied.panelOrder[1]);
  expect(applied.layoutSettings.gutterMm).toEqual({horizontal:6,vertical:6});
  const download = page.waitForEvent("download");
  await page.getByTestId("export-button").click(); await action(page,"export-svg").click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const svg = Buffer.concat(chunks).toString("utf8");
  expect(svg.match(/<text\b/g)).toHaveLength(3);
  expect(svg).not.toContain("three-regions.svg");
  if (await action(page,"close-dialog").isVisible()) await action(page,"close-dialog").click();
  await action(page,"undo").click();
  await expect.poll(async ()=>(await snapshot(page)).documentHash).toBe(base.documentHash);
});
test("preference-only input exposes unknown phrases and accepts the recognized preferences explicitly",async ({page}) => {
  const words = page.getByTestId("guide-words");
  await words.fill("高级感，突出 B，紧凑");
  await expect(page.getByText(/仍需确认的文字.*高级感/)).toBeVisible();
  await expect(action(page,"generate-guided")).toBeDisabled();
  await page.getByRole("checkbox",{name:"跳过这些文字，使用下方设置"}).check();
  await page.getByLabel("面板间距 (mm)",{exact:true}).fill("3.5");
  const waiting=page.waitForResponse(r=>r.url().endsWith("/layout-candidates")&&r.request().method()==="POST");
  await action(page,"generate-guided").click();
  const r=await waiting, req=r.request().postDataJSON().request;
  expect(r.ok()).toBe(true); expect(req.referenceSlots).toBeUndefined();
  expect(req.preferences.gapMm).toBe(3.5); expect(JSON.stringify(req)).not.toContain("高级感");
  await expect(page.getByTestId("candidate-card").first()).toContainText("按排版偏好");
});
test("blank references can be redrawn, reassigned and removed",async({page})=>{
  await page.getByTestId("reference-file").setInputFiles(image("blank.svg",'<rect width="400" height="240" fill="white"/>'));
  const sheet=page.getByTestId("reference-sheet"); await expect(sheet).toBeVisible();
  await expect(action(page,"generate-guided")).toBeDisabled();
  const frame=(await sheet.boundingBox())!;
  for (const [x,y,w,h] of [[.02,.02,.33,.42],[.39,.02,.58,.90],[.02,.51,.33,.41]] as const) {
    await page.mouse.move(frame.x+x*frame.width,frame.y+y*frame.height); await page.mouse.down();
    await page.mouse.move(frame.x+(x+w)*frame.width,frame.y+(y+h)*frame.height); await page.mouse.up();
  }
  await expect(page.locator(".guide-box")).toHaveCount(3);
  const selectors=page.locator(".guide-regions select"), first=await selectors.nth(0).inputValue(), second=await selectors.nth(1).inputValue();
  await selectors.first().selectOption(second); await expect(selectors.nth(1)).toHaveValue(first);
  await expect(action(page,"generate-guided")).toBeEnabled();
  await page.getByRole("button",{name:"删除区域 3"}).click(); await expect(action(page,"generate-guided")).toBeDisabled();
  await action(page,"add-reference-region").click(); await expect(page.getByLabel("宽 %")).toBeVisible();
  await action(page,"remove-reference").click(); await expect(sheet).toHaveCount(0);
  await page.getByTestId("guide-words").fill("紧凑");
  await page.getByTestId("reference-file").setInputFiles({name:"broken.png",mimeType:"image/png",buffer:Buffer.from("incomplete image")});
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(action(page,"generate-guided")).toBeDisabled();
  await action(page,"remove-reference").click(); await expect(action(page,"generate-guided")).toBeEnabled();
});
