// Run the actual PanelStudio solver. Only training-paper positions are accessible to retrieval.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const checkout = fileURLToPath(new URL("../../", import.meta.url));
const server = path.join(checkout, "apps/server");
const requireServer = createRequire(path.join(server, "package.json"));
const { createServer } = await import(pathToFileURL(requireServer.resolve("vite")).href);
const work = path.resolve(process.argv[2] ?? ".panelstudio/layout-learning-01");
const job = process.argv[3] ? path.resolve(process.argv[3]) : work;
const read = name => JSON.parse(readFileSync(path.join(work, name), "utf8"));
const engine = await createServer({root: server, configFile: false, appType: "custom", logLevel: "error",
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true }});

function makeInput(source, defaults) {
  const document = defaults(), assets = {};
  document.labelStyle.visible = false; // Original panel crops already include their lettering.
  for (const [i, ratio] of source.aspects.entries()) {
    const suffix = String(i + 1).padStart(12, "0");
    const id = "11111111-1111-4111-8111-" + suffix, assetId = "22222222-2222-4222-8222-" + suffix;
    const w = Math.min(32, 30 * ratio);
    document.panels[id] = { assetId, name: String.fromCharCode(65 + i), locked: false,
      frameMm: { x: 8 + 48 * (i % 3), y: 8 + 35 * Math.floor(i / 3), width: w, height: w / ratio },
      cropNormalized: {x: 0, y: 0, width: 1, height: 1},
      labelOverrides: {visible: null, text: null, typography: null, offsetMm: null, placement: null} };
    document.panelOrder.push(id);
    document.stackOrder.push(id);
    assets[assetId] = { viewport: {width: 100 * ratio, height: 100}, rasterPixelSize: null };
  }
  if (source.intent?.equalHeight && source.intent.pair) {
    document.layoutSettings.constraints.push({id:"33333333-3333-4333-8333-000000000001",kind:"equalHeight",
      panelIds:source.intent.pair.map(l=>document.panelOrder[l.charCodeAt(0)-65])});
  }
  return { document, assets };
}

function* rowPatterns(ids) {
  if (!ids.length) { yield []; return; }
  for (let n = 1; n <= Math.min(3, ids.length); n++) {
    for (const tail of rowPatterns(ids.slice(n))) yield [ids.slice(0,n), ...tail];
  }
}

function transferRequest(boxes, units) {
  const minX=Math.min(...boxes.map(b=>b[0])), minY=Math.min(...boxes.map(b=>b[1]));
  const w=Math.max(...boxes.map(b=>b[2]))-minX, h=Math.max(...boxes.map(b=>b[3]))-minY;
  return {family:"guided", preferences:{}, referenceAspect:w/h,
    referenceSlots:boxes.map(([x,y,r,b], i)=>({unitId:units[i], x:(x-minX)/w, y:(y-minY)/h, width:(r-x)/w, height:(b-y)/h}))};
}

function references(target, library) {
  return library.filter(r=>r.group!==target.group && r.aspects.length===target.aspects.length).map(ref=>{
    const shape = Math.sqrt(ref.aspects.reduce((sum,v,i)=>sum+Math.log(v/target.aspects[i])**2,0)/ref.aspects.length);
    const content = ref.posteriors.reduce((sum,row,i)=>sum+row.reduce((d,v,k)=>d+Math.abs(v-target.posteriors[i][k]),0),0)
      /(2*ref.aspects.length);
    return {ref,shape,semantic:shape+.35*content};
  });
}

function goalReferences(units, requested) {
  if (!requested.focus) return [];
  const focus=units[requested.focus.charCodeAt(0)-65];
  const paired=(requested.pair??[]).map(c=>units[c.charCodeAt(0)-65]).filter(id=>id!==focus);
  const rest=units.filter(id=>id!==focus && !paired.includes(id)).concat(paired);
  const patterns=[...rowPatterns([focus,...rest])].sort((a,b)=>
    Math.abs(a.length-Math.sqrt(units.length))-Math.abs(b.length-Math.sqrt(units.length)));
  const requests=[];
  for (const rows of patterns.slice(0,16)) {
    for (const aspect of [1,1.4]) {
      const total=rows.length+.2;
      const slots=[]; let y=0;
      for (const [ri,row] of rows.entries()) {
        const h=(ri===0?1.2:1)/total, tw=row.length+(ri===0?.45:0);
        let x=0;
        for (const id of row) {
          const w=(id===focus?1.45:1)/tw;
          slots.push({unitId:id,x:x+.002,y:y+.002,width:w-.004,height:h-.004});
          x+=w;
        }
        y+=h;
      }
      requests.push({family:"guided",referenceSlots:slots,referenceAspect:aspect});
    }
  }
  return requests;
}

try {
  const { solveLayout } = await engine.ssrLoadModule("@panelstudio/layout");
  const { createDefaultFigureDocument } = await engine.ssrLoadModule("@panelstudio/contracts");
  const published = read("inputs.json");
  const inputs = job===work ? published : JSON.parse(readFileSync(path.join(job,"inputs.json"),"utf8"));
  const trainIds = new Set(published.filter(r=>r.split==="train").map(r=>r.id));
  const geometry = new Map(read("geometry.json").filter(r=>trainIds.has(r.id)).map(r=>[r.id,r]));
  const library = published.filter(r=>trainIds.has(r.id));
  const collection=[];
  for (const source of inputs) {
    const input=makeInput(source,createDefaultFigureDocument), units=input.document.panelOrder.map(id=>"panel:"+id);
    const pool=new Map(), refs=references(source,library);
    const keyFor=boxes=>boxes.flat().map(v=>Math.round(v*100)).join(",");
    const add=(candidate,origin,refInfo)=>{
      const doc=candidate.previewDocument;
      const boxes=doc.panelOrder.map(id=>{
        const f=doc.panels[id].frameMm;
        return [f.x,f.y,f.x+f.width,f.y+f.height];
      });
      const key=keyFor(boxes);
      if (!pool.has(key)) pool.set(key,{boxes,canvas:[doc.canvas.widthMm,doc.canvas.heightMm],
        cost:candidate.score.total,origins:[],refDistances:[],refs:[],index:pool.size});
      const item=pool.get(key);
      if (!item.origins.includes(origin)) item.origins.push(origin);
      if (refInfo && !item.refs.includes(refInfo.ref.id)) {
        item.refs.push(refInfo.ref.id);
        item.refDistances.push(refInfo.shape);
      }
      return item.index;
    };
    const auto=solveLayout({...input,request:{family:"auto"},maxCandidates:3});
    const visible=auto.ok?auto.candidates.map(c=>add(c,"v0.2")):[];
    for (const rows of rowPatterns(units)) {
      const result=solveLayout({...input,request:{family:"rows",rows},maxCandidates:1});
      if (result.ok) add(result.candidates[0],"rows");
    }
    const byShape=[...refs].sort((a,b)=>a.shape-b.shape || a.ref.id.localeCompare(b.ref.id)).slice(0,6);
    const byContent=[...refs].sort((a,b)=>a.semantic-b.semantic || a.ref.id.localeCompare(b.ref.id)).slice(0,6);
    const selected=new Map([...byShape,...byContent].map(r=>[r.ref.id,r]));
    const matches=new Map();
    const requested=source.intent;
    const requestedIndices=new Set();
    const letterId=letter=>units[letter.charCodeAt(0)-65];
    const prefs={};
    if (requested?.focus) prefs.focus=letterId(requested.focus);
    if (requested?.pair) prefs.pair={first:letterId(requested.pair[0]),second:letterId(requested.pair[1]),axis:"any"};
    function collectRequested(request) {
      const result=solveLayout({...input,request:{...request,preferences:prefs},maxCandidates:3});
      if (result.ok) for (const c of result.candidates) requestedIndices.add(add(c,"author"));
    }
    if (requested) {
      collectRequested({family:"guided"});
      for (const req of goalReferences(units,requested)) collectRequested(req);
    }
    for (const item of selected.values()) {
      const g=geometry.get(item.ref.id);
      const boxes=Object.keys(g.boxes).sort().map(k=>g.boxes[k]);
      const request=transferRequest(boxes,units);
      if (requested) collectRequested(request);
      const result=solveLayout({...input,request,maxCandidates:3});
      if (!result.ok) continue;
      const options=result.candidates.map(c=>({index:add(c,"retrieval",item),proportion:c.summary==="参考区域比例"}));
      matches.set(item.ref.id,(options.find(c=>c.proportion)??options[0]).index);
    }
    const nearest=byShape.find(r=>matches.has(r.ref.id));
    collection.push({id:source.id,baseline:visible[0]??null,retrieved:nearest?matches.get(nearest.ref.id):(visible[0]??null),
      referenceIds:[...selected.keys()],...(requested?{requestedIndices:[...requestedIndices]}:{}),candidates:[...pool.values()]});
  }
  writeFileSync(path.join(job,"candidates.json"),JSON.stringify(collection)+"\n");
  console.log(collection.length,"figures,",collection.reduce((n,f)=>n+f.candidates.length,0),"distinct legal layouts,",
    collection.filter(f=>f.baseline===null).length,"unavailable v0.2 defaults");
} finally {
  await engine.close();
}

