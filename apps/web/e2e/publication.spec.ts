import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { FrozenScene } from "@panelstudio/ai";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const output=path.join(repo,".panelstudio/acceptance-v0.3");
type Wire={messages:Array<{role:string;content:string|Array<{type:string;text?:string;image_url?:{url:string}}>} >};
let provider: Server;
let port=0;
const seen: Array<{scene:FrozenScene;wire:Wire}>=[];
test.beforeAll(async()=>{
  mkdirSync(output,{recursive:true});
  provider=createServer((request,response)=>{
    const chunks:Buffer[]=[];
    request.on("data",chunk=>chunks.push(Buffer.from(chunk)));
    request.on("end",()=>{
      try {
        const wire=JSON.parse(Buffer.concat(chunks).toString()) as Wire;
        const body=wire.messages.find(m=>m.role==="user")!.content;
        const text=typeof body==="string"?body:body[0]!.text!;
        const scene=JSON.parse(text.split("\nSCENE:\n")[1]!) as FrozenScene;
        seen.push({scene,wire});
        const accepted=scene.layoutExamples?.find(r=>r.origin==="accepted");
        const action=accepted?{type:"reference_layout",referenceId:accepted.id,
          orderedUnitIds:scene.panels.map(p=>"panel:"+p.panelId),preferences:{}}:
          {type:"layout",request:{family:"guided",preferences:{focus:"panel:"+scene.panels[2]!.panelId,
            pair:{first:"panel:"+scene.panels[0]!.panelId,second:"panel:"+scene.panels[1]!.panelId,axis:"horizontal"}}}};
        response.setHeader("content-type","application/json");
        response.end(JSON.stringify({choices:[{message:{content:JSON.stringify({version:1,kind:"proposal",summary:"C 居主位，A、B 并排。",actions:[action]})}}]}));
      } catch(error) {
        response.statusCode=500;response.end(String(error));
      }
    });
  });
  provider.listen(0,"127.0.0.1");await once(provider,"listening");
  const addr=provider.address();port=addr && typeof addr==="object"?addr.port:0;
});
test.afterAll(()=>provider.close());

test("new-project brief, configured vision images, editable proposal and adopted references",async({page})=>{
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem("panelstudio.prefs",JSON.stringify({theme:"light",locale:"zh-CN",motion:"off"})));
  await page.goto("/app");
  const files=[1,1,1.5].map((ratio,i)=>({
    name:["control","condition","quantification"][i]+".svg",mimeType:"image/svg+xml",
    buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+ratio*40+' 40"><rect width="'+ratio*40+'" height="40" fill="'+["#668977","#8a7165","#bdcaaf"][i]+'"/></svg>'),
  }));
  await page.getByTestId("import-input").setInputFiles(files);
  await expect(page.getByRole("dialog",{name:"排版目标"})).toBeVisible();
  await page.getByTestId("target-journal").fill("Nature Communications");
  await page.getByTestId("research-field").fill("肿瘤 蛋白降解");
  await page.getByTestId("figure-message").fill("突出定量结果，两组代表图并排");
  await page.getByRole("radio", { name: "突出主要结果" }).check();
  await page.screenshot({animations:"disabled",path:path.join(output,"publication-context.png")});
  await page.locator('[data-action="save-publication"]').click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  await page.reload();
  const id=await page.evaluate(()=>localStorage.getItem("panelstudio.projectId"));
  const prefix="/api/v1/projects/"+id;
  const snapshot=async()=> (await page.request.get(prefix+"/document")).json();
  const original=await snapshot();
  expect(original.document.publicationContext).toEqual({journal:"Nature Communications",field:"肿瘤 蛋白降解",
    message:"突出定量结果，两组代表图并排",preference:"emphasis"});
  const write=async(url:string,data:unknown)=>
    page.request.put(url,{headers:{"Idempotency-Key":crypto.randomUUID()},data});
  expect((await write("/api/v1/settings/ai-provider",{adapter:"openai-compatible",model:"test-vision",
    baseUrl:"http://127.0.0.1:"+port+"/v1",capabilities:{imageInput:true,structuredOutput:"json_object"},allowLocalEndpoint:true})).ok()).toBe(true);
  expect((await write("/api/v1/settings/ai-provider/secret",{secret:"ephemeral-browser-vision"})).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("layout-button")).toHaveText("一键排版");
  await page.locator("[data-action=tab-ai]").click();
  await page.locator("[data-action=ai-content-layout]").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  expect(seen[0]!.scene.publicationContext).toEqual(original.document.publicationContext);
  const content=seen[0]!.wire.messages.find(m=>m.role==="user")!.content;
  expect(Array.isArray(content) && content.filter(p=>p.type==="image_url").length).toBe(4);
  await expect(page.locator("[data-action=ai-apply]")).toBeInViewport();
  await expect(page.locator("[data-action=ai-discard]")).toBeInViewport();
  await page.screenshot({animations:"disabled",path:path.join(output,"content-proposal.png")});
  await page.locator('[data-action="ai-apply"]').click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  const applied=await snapshot();
  expect(applied.document.publicationContext).toEqual(original.document.publicationContext);
  const panels=applied.document.panelOrder.map((key:string)=>applied.document.panels[key].frameMm);
  expect(panels[2].width*panels[2].height).toBeGreaterThan(panels[0].width*panels[0].height);
  await page.locator('[data-action="ai-content-layout"]').click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  expect(seen.at(-1)!.scene.layoutExamples?.some(r=>r.origin==="accepted")).toBe(true);
  await page.locator('[data-action="ai-discard"]').click();
  await page.getByTestId("export-button").click();
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"可编辑 SVG",exact:true}).click();
  const download=await pending;
  await download.saveAs(path.join(output,"content-proposal.svg"));
  await page.getByRole("button",{name:"关闭",exact:true}).click();
  await page.locator('[data-action="undo"]').click();
  await expect.poll(async()=>(await snapshot()).documentHash).toBe(original.documentHash);
  await page.locator('[data-action="publication-context"]').click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByTestId("target-journal")).toHaveValue("Nature Communications");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

