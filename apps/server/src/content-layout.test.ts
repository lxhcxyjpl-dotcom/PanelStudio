import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AIIntent, type Candidate, type FigureDocumentV1, type LayoutExample } from "@panelstudio/contracts";
import type { FrozenScene } from "@panelstudio/ai";
import { compileProposal, buildScene } from "@panelstudio/ai";
import type { AssetLookup } from "@panelstudio/core";
import { createServer, drainServerAiJobs } from "./index.js";
import { waitForTerminalJob } from "./test-jobs.js";

const handles: Array<{app: ReturnType<typeof createServer>; dir: string}> = [];
afterEach(async () => {
  for (const {app,dir} of handles.splice(0)) {
    await app.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
const context = { journal:"Example Journal", field:"蛋白降解", message:"突出定量比较", preference:"comparison" as const };

function example(id: string, journal: string, field: string): LayoutExample {
  return {id,origin:"paper",journal,field,sourceUrl:"https://example.test/article",aspect:1.4,
    panelTypes:["diagram","plot","image","image","plot","plot"],
    slots: Array.from({length:6},(_,i)=>({x:(i%3)/3,y:Math.floor(i/3)/2,width:.32,height:.48}))};
}
type Wire = {
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
};
async function setup() {
  const dir=mkdtempSync(path.join(os.tmpdir(),"panelstudio-content-"));
  const scenes: FrozenScene[] = [], wires: Wire[] = [];
  const app=createServer({dataDir:dir,deferAiJobs:true,aiFetch:async(_url,init)=>{
    const body=JSON.parse(String(init?.body)) as Wire;
    wires.push(body);
    const message=body.messages.find(m=>m.role==="user")!.content;
    const text=typeof message==="string"?message:message[0]!.text!;
    const scene=JSON.parse(text.split("\nSCENE:\n")[1]!) as FrozenScene;
    scenes.push(scene);
    const ref=scene.layoutExamples?.[0];
    const action=ref?{type:"reference_layout" as const,referenceId:ref.id,
      orderedUnitIds:scene.panels.map(p=>"panel:"+p.panelId),preferences:{}}:
      {type:"layout" as const,request:{family:"rows" as const}};
    return Response.json({choices:[{message:{content:JSON.stringify({version:1,kind:"proposal",summary:"按内容排版",actions:[action]})}}]});
  }});
  handles.push({app,dir});
  const post=(url:string,payload:unknown)=>app.inject({method:"POST",url,headers:{"idempotency-key":randomUUID()},payload:payload as object});
  for(const [route,payload] of [
    ["/api/v1/settings/ai-provider",{adapter:"openai-compatible",baseUrl:"http://127.0.0.1:1/v1",model:"fake-vision",
      capabilities:{imageInput:true,structuredOutput:"json_object"},allowLocalEndpoint:true}],
    ["/api/v1/settings/ai-provider/secret",{secret:"temporary-content-test"}],
  ] as const) {
    expect((await app.inject({method:"PUT",url:route,headers:{"idempotency-key":randomUUID()},payload})).statusCode).toBe(200);
  }
  const upload=await app.inject({method:"POST",url:"/api/v1/project-imports",
    headers:{"idempotency-key":randomUUID(),"content-type":"multipart/form-data; boundary=example"},
    payload:Buffer.concat([Buffer.from('--example\r\nContent-Disposition: form-data; name="file"; filename="six.figurezip"\r\nContent-Type: application/zip\r\n\r\n'),
      readFileSync(new URL("../../../examples/synthetic-six/synthetic-six.figurezip",import.meta.url)),
      Buffer.from("\r\n--example--\r\n")])});
  expect(upload.statusCode,upload.body).toBe(202);
  const job=await waitForTerminalJob(app,upload.json().jobId);
  if(job.status!=="succeeded" || !job.result || !("projectId" in job.result)) throw Error(JSON.stringify(job));
  const prefix="/api/v1/projects/"+job.result.projectId;
  const state=async()=> (await app.inject({method:"GET",url:prefix+"/document"})).json() as {revision:number;document:FigureDocumentV1};
  const edit=async(commands:unknown[])=> {
    const current=await state();
    const response=await post(prefix+"/transactions",{baseRevision:current.revision,commands});
    expect(response.statusCode,response.body).toBe(200);
    return response.json();
  };
  const turn=async(images=true)=> {
    const current=await state();
    const queued=await post(prefix+"/ai-layouts",{baseRevision:current.revision,scope:"document",selectedPanelIds:[],
      prompt:"按内容排版",replyLocale:"zh-CN",includePreviewImage:images,visualReview:false});
    expect(queued.statusCode,queued.body).toBe(202);
    await drainServerAiJobs(app);
    return (await app.inject({method:"GET",url:"/api/v1/jobs/"+queued.json().jobId})).json();
  };
  return {app,dir,post,prefix,state,edit,turn,scenes,wires};
}

describe("content-aware layout through the configured API",()=>{
  it("persists the author brief and sends independent images and matched real examples",async()=>{
    const f=await setup();
    const refs=[example("unrelated","Other Journal","astronomy"),example("matched",context.journal,"protein degradation")];
    writeFileSync(path.join(f.dir,"layout-references.json"),JSON.stringify(refs));
    await f.edit([{type:"figure.setPublicationContext",publicationContext:context}]);
    expect((await f.state()).document.publicationContext).toEqual(context);
    const result=await f.turn();
    expect(result.status,JSON.stringify(result)).toBe("succeeded");
    const candidate=result.result.candidates[0] as Candidate;
    expect(candidate.previewDocument.publicationContext).toEqual(context);
    expect(f.scenes[0]!.publicationContext).toEqual(context);
    expect(f.scenes[0]!.layoutExamples?.map(r=>r.id)).toEqual(["matched"]);
    const wire=f.wires[0]!.messages.find(m=>m.role==="user")!.content;
    expect(Array.isArray(wire)).toBe(true);
    if(typeof wire==="string") throw Error("Missing image inputs");
    expect(wire.filter(v=>v.type==="image_url")).toHaveLength(7);
    const ids=f.scenes[0]!.panels.map(p=>p.panelId);
    expect(wire.filter(v=>v.text?.startsWith("Independent panel ")).map(v=>v.text)).toEqual(ids.map(id=>"Independent panel "+id));
    const current=await f.state();
    const accepted=await f.post(f.prefix+"/transactions",{baseRevision:current.revision,candidateId:candidate.id});
    expect(accepted.statusCode,accepted.body).toBe(200);
    await f.turn(false);
    expect(f.scenes.at(-1)!.layoutExamples?.[0]?.origin).toBe("accepted");
    expect(typeof f.wires.at(-1)!.messages.find(m=>m.role==="user")!.content).toBe("string");
    const undo=await f.post(f.prefix+"/history/undo",{baseRevision:(await f.state()).revision});
    expect(undo.statusCode).toBe(200);
    await f.turn(false);
    expect(f.scenes.at(-1)!.layoutExamples?.every(r=>r.origin==="paper")).toBe(true);
    const redo=await f.post(f.prefix+"/history/redo",{baseRevision:(await f.state()).revision});
    expect(redo.statusCode).toBe(200);
    await f.turn(false);
    expect(f.scenes.at(-1)!.layoutExamples?.[0]?.origin).toBe("accepted");
  });

  it("rejects invented examples and mappings and enforces selection scope",async()=>{
    const f=await setup();
    const doc=(await f.state()).document;
    const facts: AssetLookup=id=>{
      const panel=Object.values(doc.panels).find(p=>p.assetId===id);
      if(!panel)return null;
      return {id,originalFilename:"test",viewport:{width:panel.frameMm.width,height:panel.frameMm.height},rasterPixelSize:null};
    };
    const action={type:"reference_layout" as const,referenceId:"known",
      orderedUnitIds:doc.panelOrder.map(id=>"panel:"+id),preferences:{}};
    const proposal: Extract<AIIntent,{kind:"proposal"}>={version:1,kind:"proposal",summary:"Arrange",actions:[action]};
    expect(()=>compileProposal(doc,proposal,facts)).toThrow(/provided example/);
    const ref=example("known",context.journal,context.field);
    expect(()=>compileProposal(doc,proposal,facts,{scope:"selection",selectedPanelIds:doc.panelOrder},[ref])).toThrow(/document scope/);
    expect(()=>compileProposal(doc,{...proposal,actions:[{...action,orderedUnitIds:[...action.orderedUnitIds.slice(1),action.orderedUnitIds[1]!]}]},facts,undefined,[ref])).toThrow(/provided example/);
    const scene=buildScene(doc,{baseRevision:0,configRevision:0,selectedPanelIds:[]});
    expect(scene.publicationContext).toBeUndefined();
    const old=await f.turn(false);
    expect(old.status).toBe("succeeded");
  });

  it("freezes reference metadata for queued requests and ignores incomplete library files",async()=>{
    const f=await setup();
    await f.edit([{type:"figure.setPublicationContext",publicationContext:context}]);
    const file=path.join(f.dir,"layout-references.json");
    writeFileSync(file,JSON.stringify([example("frozen",context.journal,context.field)]));
    const queued=await f.post(f.prefix+"/ai-layouts",{baseRevision:(await f.state()).revision,selectedPanelIds:[],
      prompt:"排版",replyLocale:"zh-CN",includePreviewImage:false,visualReview:false});
    writeFileSync(file,"{incomplete");
    await drainServerAiJobs(f.app);
    const job=(await f.app.inject({method:"GET",url:"/api/v1/jobs/"+queued.json().jobId})).json();
    expect(job.status,JSON.stringify(job)).toBe("succeeded");
    expect(f.scenes.at(-1)!.layoutExamples?.[0]?.id).toBe("frozen");
    expect((await f.turn(false)).status).toBe("succeeded");
    expect(f.scenes.at(-1)!.layoutExamples).toEqual([]);
  });
});

