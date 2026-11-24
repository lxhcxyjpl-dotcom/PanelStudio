import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const names = ["ggplot2-scatter.svg","ggplot2-scatter-natural-width.svg","ggplot2-scatter.svg","ggplot2-scatter-natural-width.svg"];
const figure = (name: string) => fileURLToPath(new URL("../../../fixtures/scientific-svg/"+name,import.meta.url));
const action = (page: Page, name: string) => page.locator('[data-action="'+name+'"]:visible');
const provider = { hasSecret:true, configRevision:1, config:{baseUrl:"https://api.deepseek.com",model:"fixture",capabilities:{imageInput:true}} };
const clearGoal = "Fig. 2 想比较两组随剂量的变化，整张宽85 mm";

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs",JSON.stringify({locale:"zh-CN",theme:"light",motion:"off"})));
  await page.route("**/api/v1/settings/ai-provider",route=>route.fulfill({json:provider}));
  await page.route("**/figure-readings",async route=>{
    const body=route.request().postDataJSON();
    if (!body.vision) return route.continue();
    const local=await route.fetch({postData:{...body,vision:false,configRevision:undefined}});
    await route.fulfill({response:local});
  });
});

async function start(page: Page, goal: string) {
  await page.goto("/");
  await expect(page.getByTestId("use-image-model").filter({visible:true})).toBeChecked();
  await page.locator(".opening-chat input[type=file]").setInputFiles(names.map((name,index)=>({
    name:"scan_"+(index+1)+".svg",mimeType:"image/svg+xml",buffer:readFileSync(figure(name)),
  })));
  await page.getByTestId("start-brief").fill(goal);
  await action(page,"start-send").click();
}

function proposal(ids: string[]) {
  const [a,b,c,d] = ids as [string,string,string,string];
  return {
    kind:"proposal", reply:"保留两组原始点，并列出剂量趋势。",
    picks:[{id:a,reason:"对照观测"},{id:b,reason:"处理组观测"},{id:c,reason:"剂量趋势"}],
    supplementary:[{id:d,reason:"样本数核对"}],
    rows:[[a,b],[c]],
  };
}

function gate() {
  let open!: () => void;
  const ready = new Promise<void>(resolve => { open = resolve; });
  return {ready,open};
}

test("the model arranges every supplied figure and can give a grounded main panel", async ({page}) => {
  const layouts: unknown[] = [];
  await page.route("**/figure-discussion", route => {
    const body = route.request().postDataJSON();
    layouts.push(body.curation);
    const ids = body.assets.map((item: {id:string}) => item.id);
    return route.fulfill({json:{
      kind:"proposal", reply:"先看第三张的总体分布，再比较两张观测图。",
      picks:ids.map((id:string) => ({id, reason:"保留作者提供的图"})), supplementary:[],
      primaryId:ids[2], rows:[[ids[2]],[ids[0],ids[1],ids[3]]],
    }});
  });
  await start(page, "");
  await expect(page.getByTestId("wish-workbench")).toContainText("先看第三张的总体分布");
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  expect(layouts).toEqual([{allowQuestion:false,layoutAll:true}]);
  const project = new URL(page.url()).pathname.split("/").at(-1);
  const {document} = await (await page.request.get("/api/v1/projects/"+project+"/document")).json();
  const frames = document.panelOrder.map((id:string) => document.panels[id]);
  expect(frames).toHaveLength(4);
  expect(frames[0].name).toBe("scan_3.svg");
  expect(frames[0].frameMm.width).toBeGreaterThan(frames[1].frameMm.width);
  expect(frames[1].frameMm.y).toBeCloseTo(frames[2].frameMm.y,5);
});

test("uses the reading time to review images, add a confirmed note and prepare a follow-up", async ({page},info) => {
  await page.setViewportSize({width:390,height:844});
  const reading=gate(), choosing=gate(), started=gate();
  let assetIds:string[]=[];
  await page.route("**/figure-readings",async route=>{
    const body=route.request().postDataJSON();
    if (body.vision) {
      assetIds=body.assetIds;
      started.open();
      await reading.ready;
    }
    await route.fallback();
  });
  const originalNote="OJ 组的逐剂量观测值";
  const localNote="这张还需要核对分组";
  let requests=0;
  await page.route("**/figure-discussion",async route=>{
    const body=route.request().postDataJSON();
    requests++;
    expect(body.assets.map((asset:{note:string})=>asset.note)).toEqual([originalNote,"","",""]);
    expect(body.turns).toEqual([clearGoal]);
    await choosing.ready;
    await route.fulfill({json:proposal(assetIds)});
  });
  await start(page,clearGoal);
  await started.ready;
  const composer=page.getByTestId("wish-input");
  await expect(composer).toHaveAttribute("placeholder","先写下下一步…");
  await composer.fill("排好后看看 C 的字号");
  await expect(action(page,"inspect-while-waiting")).toHaveCount(4);
  await page.screenshot({path:info.outputPath("01-读图时可浏览.png")});
  await action(page,"inspect-while-waiting").first().click();
  const review=page.getByRole("dialog");
  await expect(review).toHaveAccessibleName("scan_1.svg");
  const field=review.getByRole("textbox",{name:"这张图展示什么？"});
  await field.fill(originalNote);
  await action(page,"wish-use-note").click();
  await expect(review.getByRole("button",{name:"已加入本轮"})).toBeDisabled();
  await page.screenshot({path:info.outputPath("02-备注加入本轮.png")});
  await review.getByRole("button",{name:"下一张"}).click();
  await expect(review).toHaveAccessibleName("scan_2.svg");
  await field.fill(localNote);
  expect(requests).toBe(0);
  reading.open();
  await expect(review.getByRole("button",{name:"用于本轮"})).toHaveCount(0);
  const dialog=await review.elementHandle();
  choosing.open();
  await expect(review.getByRole("button",{name:"看首稿"})).toBeVisible();
  expect(await dialog?.evaluate(el=>el.isConnected)).toBe(true);
  await expect(field).toHaveValue(localNote);
  await review.getByRole("button",{name:"看首稿"}).click();
  await expect(action(page,"show-curation")).toHaveText("主图 3 · 补充图 1");
  await expect(composer).toHaveValue("排好后看看 C 的字号");
  expect(requests).toBe(1);
  await page.reload();
  await expect(composer).toHaveValue("排好后看看 C 的字号");
});

test("stopping the image reading keeps the author's notes without requesting a shortlist", async ({page}) => {
  const reading=gate(), started=gate();
  let requests=0;
  await page.route("**/figure-readings",async route=>{
    if (route.request().postDataJSON().vision) {
      started.open();
      await reading.ready;
      await route.abort().catch(()=>{});
    } else await route.fallback();
  });
  await page.route("**/figure-discussion",route=>{requests++;return route.abort();});
  const dialog=page.getByRole("dialog");
  try {
    await start(page,clearGoal);
    await started.ready;
    await action(page,"inspect-while-waiting").first().click();
    await dialog.getByRole("textbox",{name:"这张图展示什么？"}).fill("处理组原始点");
    await action(page,"wish-use-note").click();
    await expect(action(page,"wish-use-note")).toHaveText("已加入本轮");
    await dialog.getByRole("button",{name:"关闭"}).click();
    await action(page,"stop-discussion").click();
  } finally {
    reading.open();
  }
  await expect(page.getByTestId("wish-workbench")).toContainText("回复已停止");
  expect(requests).toBe(0);
  await action(page,"inspect-candidate").first().click();
  await expect(page.getByRole("dialog").getByRole("textbox",{name:"这张图展示什么？"})).toHaveValue("处理组原始点");
});

test("drafts main panels immediately, then swaps a supplementary image in one undoable operation", async ({page,browser}) => {
  await page.setViewportSize({width:390,height:844});
  let calls=0;
  await page.route("**/figure-discussion",route=>{
    const req=route.request().postDataJSON();
    calls++;
    expect(req.curation).toEqual({allowQuestion:true});
    return route.fulfill({json:proposal(req.assets.map((asset:{id:string})=>asset.id))});
  });
  await start(page,clearGoal);
  const summary=action(page,"show-curation");
  await expect(summary).toHaveText("主图 3 · 补充图 1");
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  expect(calls).toBe(1);
  const snapshot=async()=> (await page.request.get("/api/v1/projects/"+new URL(page.url()).pathname.split("/").at(-1)+"/document")).json();
  const first=await snapshot();
  expect(first.document.canvas.widthMm).toBe(85);
  expect(first.document.curation.supplementary).toHaveLength(1);
  await summary.click();
  const review=page.getByRole("dialog",{name:"选图结果"});
  const supplement=review.locator("[data-curation-supplement]");
  await expect(supplement).toContainText("样本数核对");
  const asset=await supplement.getAttribute("data-curation-supplement");
  await review.getByRole("button",{name:"换掉 B"}).click();
  await review.locator('[data-curation-asset="'+asset+'"]').click();
  await expect(review).toHaveCount(0);
  await expect(summary).toHaveText("主图 3 · 补充图 0");
  const revised=await snapshot();
  const [a,b,c]= first.document.panelOrder as string[];
  expect(revised.revision).toBe(first.revision+1);
  expect(revised.document.panelOrder).toEqual([a,b,c]);
  expect(revised.document.panels[b!].assetId).toBe(asset);
  expect(revised.document.panels[a!].assetId).toBe(first.document.panels[a!].assetId);
  expect(revised.document.panels[c!].frameMm.y).toBeGreaterThan(revised.document.panels[a!].frameMm.y);
  const change = page.getByTestId("wish-edit-feedback");
  await expect(change.getByRole("button",{name:"定位面板 B"})).toBeVisible();
  await expect(change).toContainText(/换图 .+ → .+/);
  await change.getByRole("button",{name:"撤销",exact:true}).click();
  await expect(summary).toHaveText("主图 3 · 补充图 1");
  expect((await snapshot()).documentHash).toBe(first.documentHash);
  await action(page,"redo").click();
  await expect(summary).toHaveText("主图 3 · 补充图 0");
  await page.reload();
  await expect(summary).toHaveText("主图 3 · 补充图 0");
  expect((await snapshot()).documentHash).toBe(revised.documentHash);
  const chat=page.getByTestId("wish-input");
  await chat.fill("把 B 换成 #2");
  await chat.press("Enter");
  await expect(summary).toHaveText("主图 3 · 补充图 1");
  const viaChat=await snapshot();
  expect(viaChat.document.panels[b!].assetId).toBe(first.document.panels[b!].assetId);
  expect(viaChat.revision).toBeGreaterThan(revised.revision);
  const newContext=await browser.newContext({viewport:{width:390,height:844}});
  try {
    await newContext.addInitScript(()=>localStorage.setItem("panelstudio.prefs",JSON.stringify({locale:"zh-CN"})));
    const reopened=await newContext.newPage();
    await reopened.goto(page.url());
    await action(reopened,"show-curation").click();
    await expect(reopened.locator("[data-curation-supplement]")).toContainText("样本数核对");
  } finally {
    await newContext.close();
  }
  expect(calls).toBe(1);
});

test("uses an answer to a material question to draft directly and keeps the custom input", async ({page}) => {
  let calls=0;
  await page.route("**/figure-discussion",route=>{
    const body=route.request().postDataJSON();
    if (++calls===1) return route.fulfill({json:{kind:"question",reply:"要展示剂量趋势，还是两组合并结果？",
      options:["剂量趋势","合并结果"],picks:[],rows:[]}});
    expect(body.curation).toEqual({allowQuestion:false});
    expect(body.turns.at(-1)).toBe("剂量趋势");
    return route.fulfill({json:proposal(body.assets.map((a:{id:string})=>a.id))});
  });
  await start(page,"Fig. 2 我还没想好重点，帮我挑主图和补充图。");
  const question=page.getByTestId("question-card");
  await expect(question).toContainText("要展示剂量趋势");
  await expect(page.locator(".panel-frame")).toHaveCount(0);
  await page.getByTestId("wish-input").fill("下次再说具体尺寸");
  await question.getByRole("button",{name:"剂量趋势"}).click();
  await expect(action(page,"show-curation")).toHaveText("主图 3 · 补充图 1");
  await expect(page.getByTestId("wish-input")).toHaveValue("下次再说具体尺寸");
  await expect(question).toHaveCount(0);
});

test("keeps the original groups when the height limit blocks a proposed figure", async ({page}) => {
  let discussions = 0;
  await page.route("**/figure-discussion",route=>{
    discussions++;
    const ids=route.request().postDataJSON().assets.map((asset:{id:string})=>asset.id) as string[];
    return route.fulfill({json:{kind:"proposal",reply:"四张图比较两组",rows:[ids.slice(0,2),[ids[2]],[ids[3]]],
      picks:ids.map(id=>({id,reason:"提供组间对照"})),supplementary:[]}});
  });
  const sizes:number[][]=[];
  await page.route("**/layout-candidates",route=>{
    const rows=route.request().postDataJSON().request.rows as string[][];
    sizes.push(rows.map(row=>row.length));
    if (sizes.length===1) return route.fulfill({status:422,json:{error:{
      code:"LAYOUT_CONFLICT",message:"Layout exceeds height",details:{reason:"layout-max-height"},
    }}});
    return route.continue();
  });
  await start(page,"Fig. 2 想比较不同条件的结果，帮我选主图和补充图。");
  await expect(page.getByTestId("wish-workbench")).toContainText("当前画板放不下这些对照组");
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(4);
  expect(sizes).toEqual([[2,1,1]]);
  const documentUrl="/api/v1/projects/"+new URL(page.url()).pathname.split("/").at(-1)+"/document";
  const before=await (await page.request.get(documentUrl)).json();
  expect(before.revision).toBe(0);
  expect(before.document.panelOrder).toHaveLength(0);

  await page.reload();
  await action(page,"wish-adjust-canvas").click();
  const limit=page.getByTestId("wish-layout-height");
  await expect(limit).toBeVisible();
  await limit.fill("360");
  await limit.press("Enter");
  await expect.poll(async ()=> (await (await page.request.get(documentUrl)).json()).document.layoutSettings.maxAutoHeightMm).toBe(360);
  await action(page,"wish-draft").click();
  await expect(action(page,"show-curation")).toHaveText("主图 4 · 补充图 0");
  expect(sizes).toEqual([[2,1,1],[2,1,1]]);
  expect(discussions).toBe(1);
  const saved=await (await page.request.get(documentUrl)).json();
  expect(saved.document.curation.rowSizes).toEqual([2,1,1]);
  await expect(action(page,"wish-adjust-canvas")).toHaveCount(0);
});
