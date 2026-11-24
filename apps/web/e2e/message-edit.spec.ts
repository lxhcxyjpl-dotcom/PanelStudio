import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
const action = (page: Page, name: string) => page.locator('[data-action="'+name+'"]:visible');
const ask = async (page: Page, text: string) => { const input = page.getByTestId("start-brief"); await input.fill(text); await input.press("Enter"); };
const figure = (name: string) => fileURLToPath(new URL("../../../fixtures/scientific-svg/"+name,import.meta.url));
const images = [figure("ggplot2-scatter.svg"),figure("ggplot2-scatter-natural-width.svg")];
const provider = { hasSecret:true, configRevision:1, config:{baseUrl:"https://api.deepseek.com",model:"fixture",capabilities:{imageInput:true}} };
const ready = (text: string) => ({kind:"ready",intent:"arrange",reply:"已记下 "+text,options:[],request:"简报："+text});
function gate() { let open!: () => void; const ready = new Promise<void>(resolve=>{open=resolve}); return {open,ready}; }
test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem("panelstudio.prefs",JSON.stringify({locale:"zh-CN",theme:"light",motion:"off"})));
});
test("edits an earlier turn in place, keeps both continuations, and never sends staged files or the next draft",async({page})=>{
  await page.route("**/settings/ai-provider",r=>r.fulfill({json:provider}));
  const sent: {text:string;brief:string;context:string[]}[] = [];
  await page.route("**/figure-brief",r=>{ const req=r.request().postDataJSON(), text=req.turns.at(-1).text;
    sent.push({text,brief:req.brief,context:req.turns.map((v:{text:string})=>v.text)});
    return r.fulfill({json:ready(text)});
  });
  await page.goto("/"); await ask(page,"投稿期刊 PLOS ONE"); await expect(page.getByRole("log")).toContainText("已记下 投稿期刊");
  await ask(page,"图宽 85 mm"); await expect(page.getByRole("log")).toContainText("已记下 图宽 85 mm");
  await ask(page,"后来才决定放三张图"); await expect(page.getByRole("log")).toContainText("已记下 后来才决定");
  const input=page.getByTestId("start-brief"); await input.fill("下次再发的草稿");
  await page.locator(".opening-chat input[type=file]").setInputFiles(images[0]!);
  const user=page.locator(".opening-turn.user").filter({hasText:"图宽 85 mm"});
  await user.hover(); await user.getByRole("button",{name:"编辑这条消息"}).click();
  const field=page.getByTestId("edit-message-input"); await expect(field).toBeFocused();
  await field.fill("会取消的改动"); await field.press("Escape"); expect(sent).toHaveLength(3);
  await expect(input).toHaveValue("下次再发的草稿"); await user.getByRole("button",{name:"编辑这条消息"}).click();
  await field.fill("图宽 120 mm"); await field.press("Enter");
  await expect(page.getByRole("log")).toContainText("已记下 图宽 120 mm");
  expect(sent.at(-1)).toEqual({text:"图宽 120 mm",brief:"投稿期刊 PLOS ONE",context:["投稿期刊 PLOS ONE","已记下 投稿期刊 PLOS ONE","图宽 120 mm"]});
  await expect(page.getByRole("log")).not.toContainText("后来才决定"); await expect(input).toHaveValue("下次再发的草稿");
  await expect(action(page,"remove-attachment")).toHaveCount(1);
  await action(page,"previous-version").click(); await expect(page.getByRole("log")).toContainText("后来才决定放三张图");
  await page.reload(); await action(page,"next-version").click(); await expect(page.getByRole("log")).toContainText("图宽 120 mm");
  await expect(page.getByRole("log")).not.toContainText("后来才决定"); expect(sent).toHaveLength(4);
});
test("editing a pending message stops the original and discards a late reply",async({page})=>{
  await page.route("**/settings/ai-provider",r=>r.fulfill({json:provider}));
  const arrived=gate(), release=gate();
  await page.route("**/figure-brief",async r=>{ const text=r.request().postDataJSON().turns.at(-1).text;
    if(text==="第一种排法"){arrived.open();await release.ready;}
    await r.fulfill({json:ready(text)}).catch(()=>{});
  });
  await page.goto("/"); await ask(page,"第一种排法"); await arrived.ready; await expect(action(page,"stop-opening")).toBeVisible();
  await page.locator(".opening-turn.user").hover(); await action(page,"edit-message").click();
  await page.getByTestId("edit-message-input").fill("第二种排法"); await action(page,"resend-edit").click();
  await expect(page.getByRole("log")).toContainText("已记下 第二种排法");release.open();
  await action(page,"previous-version").click(); await expect(page.getByRole("log")).toContainText("回复已停止");
  await expect(page.getByRole("log")).not.toContainText("已记下 第一种排法");
});
test("keeps the version buttons in reach when returning to a long conversation",async({page})=>{
  await page.setViewportSize({width:720,height:600});
  await page.route("**/settings/ai-provider",r=>r.fulfill({json:provider}));
  await page.route("**/figure-brief",r=>{
    const said=r.request().postDataJSON().turns.at(-1).text;
    return r.fulfill({json:{...ready(said),reply:"已记下 "+said+"。"+("面板内容会影响这张图的投稿重点。".repeat(15))}});
  });
  await page.goto("/");
  for (const text of ["主图先放散点","之后补充剂量","图宽 85 mm","最后再看图注"]) {
    await ask(page,text);
    await expect(page.getByRole("log")).toContainText("已记下 "+text);
  }
  const first=page.locator(".opening-turn.user").filter({hasText:"主图先放散点"});
  await first.getByRole("button",{name:"编辑这条消息"}).focus();
  await first.getByRole("button",{name:"编辑这条消息"}).press("Enter");
  await page.getByTestId("edit-message-input").fill("主图先放剂量图");
  await action(page,"resend-edit").click();
  await expect(page.getByRole("log")).toContainText("已记下 主图先放剂量图");
  await action(page,"previous-version").focus();
  await action(page,"previous-version").press("Enter");
  await expect(action(page,"next-version")).toBeInViewport();
  await expect(action(page,"next-version")).toBeFocused();
  await expect(action(page,"chat-latest")).toBeVisible();
  await action(page,"chat-latest").click();
  await expect(page.getByText(/已记下 最后再看图注/)).toBeInViewport();
});
test("revisits a pre-upload message from the figure without exposing later photos or losing the original project",async({page})=>{
  await page.route("**/settings/ai-provider",r=>r.fulfill({json:provider}));
  const sent:string[][] = [];
  await page.route("**/figure-brief",r=>{const turns=r.request().postDataJSON().turns.map((x:{text:string})=>x.text);sent.push(turns);return r.fulfill({json:ready(turns.at(-1)!)});});
  await page.goto("/"); await ask(page,"我想比较两个条件"); await expect(page.getByRole("log")).toContainText("已记下");
  await page.locator(".model-chip").click(); await page.locator(".opening-chat input[type=file]").setInputFiles(images);
  await ask(page,"两张图都用，A 和 B 并排，图宽85mm"); await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  const original=page.url(); await action(page,"wish-discussion").click();
  const turn=page.locator(".wish-history .opening-turn.user").filter({hasText:"我想比较两个条件"});
  await turn.hover();await turn.getByRole("button",{name:"编辑这条消息"}).click();
  await page.getByTestId("edit-message-input").fill("改为比较三个时间点");await action(page,"resend-edit").click();
  await expect(page).toHaveURL(/\/$/);await expect(page.getByRole("log")).toContainText("改为比较三个时间点");
  await expect(page.getByRole("log")).not.toContainText("85mm"); await expect(action(page,"remove-attachment")).toHaveCount(0);
  await action(page,"previous-version").click();await expect(page).toHaveURL(original);
  await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
});

test("replays the earlier selection brief when editing the attachment message",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("panelstudio.visual-reading","off"));
  await page.goto("/");await ask(page,"这批图想请你帮我选图");
  await expect(page.getByTestId("question-card")).toHaveCount(0);
  await ask(page,"比较两种处理的剂量曲线");
  await page.locator(".opening-chat input[type=file]").setInputFiles(images);
  await ask(page,"两张图都用，A 和 B 并排，图宽85mm");const work=page.getByTestId("wish-workbench");
  await expect(work).toContainText("第一稿已排好");const source=page.url();
  await action(page,"wish-discussion").click();const row=work.locator(".opening-turn.user").filter({hasText:"图宽85mm"});
  await row.hover();await row.getByRole("button",{name:"编辑这条消息"}).click();
  await page.getByTestId("edit-message-input").fill("我最想呈现每组的个体差异");await action(page,"resend-edit").click();
  await expect.poll(()=>page.url()).not.toBe(source);
  await expect(work.locator("[data-asset-choice]")).toHaveCount(2);
  await expect(work).toHaveClass(/choosing/);
  await expect(page.locator(".panel-frame")).toHaveCount(0);
  await expect(work.locator(".wish-history")).toContainText("这批图想请你帮我选图");
});
test("old text-only project history can be quoted without pretending to restore a missing canvas",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("panelstudio.visual-reading","off"));
  await page.goto("/");await page.locator(".opening-chat input[type=file]").setInputFiles(images);
  await ask(page,"A 和 B 并排，图宽85mm");const work=page.getByTestId("wish-workbench");
  await expect(work).toContainText("第一稿已排好");const original=page.url();
  await page.evaluate(()=>{const key="panelstudio.figure-wish."+location.pathname.split("/").at(-1);
    const saved=JSON.parse(localStorage.getItem(key)!);delete saved.checkpoints;delete saved.opening;delete saved.identities;localStorage.setItem(key,JSON.stringify(saved));});
  await page.reload();await action(page,"wish-discussion").click();const row=work.locator(".opening-turn.user").first();
  await row.hover();await expect(row.locator('[data-action="edit-message"]')).toHaveCount(0);
  await row.getByRole("button",{name:"引用到当前输入框"}).click();
  await expect(page.getByTestId("wish-input")).toHaveValue("A 和 B 并排，图宽85mm");
  expect(page.url()).toBe(original);
});

test("stops before a delayed image reading can change the canvas",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("panelstudio.visual-reading","off"));
  const arrived=gate(),release=gate();let commits=0;
  await page.route("**/figure-readings",async route=>{ arrived.open();await release.ready;await route.abort().catch(()=>{}); });
  page.on("request",req=>{if(req.url().endsWith("/layout-candidates")) commits++;});
  await page.goto("/"); await page.locator(".opening-chat input[type=file]").setInputFiles(images);
  await ask(page,"A 和 B 并排，图宽85mm");await arrived.ready;await action(page,"stop-discussion").click();
  await expect(page.getByTestId("wish-workbench")).toContainText("回复已停止");release.open();expect(commits).toBe(0);
});

test("edits a sent figure instruction from its original revision and recovers the later hand-adjusted figure exactly",async({page},info)=>{
  await page.addInitScript(()=>localStorage.setItem("panelstudio.visual-reading","off"));
  await page.goto("/"); await page.locator(".opening-chat input[type=file]").setInputFiles(images);
  await ask(page,"A 和 B 并排，图宽85mm"); await expect(page.getByTestId("wish-workbench")).toContainText("第一稿已排好");
  const project=()=>new URL(page.url()).pathname.split("/").at(-1)!;
  const snap=async(id=project())=>(await page.request.get("/api/v1/projects/"+id+"/document")).json();
  const original=project(), baseline=await snap();
  const readings: string[] = [];
  page.on("request",request=>{if(request.url().endsWith("/figure-readings")) readings.push(request.url());});
  await page.getByTestId("wish-input").fill("把 B 缩小 10%"); await action(page,"wish-send").click();
  await expect.poll(async()=>(await snap()).revision).toBe(baseline.revision+1);
  expect(readings).toHaveLength(0);
  const after=await snap(), b=after.document.panelOrder[1], box=(await page.locator('[data-panel-id="'+b+'"]').boundingBox())!;
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.keyboard.down("Alt");await page.mouse.move(x-8,y+5,{steps:8});await page.mouse.up();await page.keyboard.up("Alt");
  await expect.poll(async()=>(await snap()).revision).toBe(after.revision+1);
  const manual=await snap();
  await action(page,"wish-discussion").click();
  const entry=page.locator(".wish-history .opening-turn.user").filter({hasText:"图宽85mm"});
  await entry.hover();await entry.getByRole("button",{name:"编辑这条消息"}).click();
  await page.getByTestId("edit-message-input").fill("A 和 B 并排，图宽120mm");await action(page,"resend-edit").click();
  await expect.poll(project).not.toBe(original);
  await expect.poll(async()=>(await snap()).document.canvas.widthMm).toBe(120);
  const edited=project(), changed=await snap(), restored=await snap(original);
  expect(restored.documentHash).toBe(manual.documentHash);
  expect(new Set(Object.values(changed.document.panels).map((p:any)=>p.assetId))).toEqual(new Set(Object.values(baseline.document.panels).map((p:any)=>p.assetId)));
  await expect(page.locator(".wish-history")).not.toContainText("把 B 缩小 10%");
  await action(page,"previous-version").click();await expect.poll(project).toBe(original);
  expect((await snap()).documentHash).toBe(manual.documentHash);
  await expect(action(page,"next-version")).toBeInViewport();
  await expect(page.locator(".wish-history")).toContainText("把 B 缩小 10%");
  await page.reload();await action(page,"next-version").click();await expect.poll(project).toBe(edited);
  expect((await snap()).documentHash).toBe(changed.documentHash);
  await page.screenshot({path:info.outputPath("Fig2-消息版本.png")});
  writeFileSync(info.outputPath("Fig2-版本核对.json"),JSON.stringify({originalWidth:manual.document.canvas.widthMm,editedWidth:changed.document.canvas.widthMm,originalHash:manual.documentHash,restoredHash:restored.documentHash,editedHash:changed.documentHash},null,2));
});
