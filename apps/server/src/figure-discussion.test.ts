import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { expect, it } from "vitest";
import { createServer } from "./index.js";

it("grounds a multi-turn shortlist in this library, sends images only on request, and preserves the figure", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "panelstudio-discussion-"));
  const seen: string[] = [];
  const exposed: string[] = [];
  let visualCalls = 0;
  let response: unknown = {
    kind: "question", reply: "Compare the dose curves or the pooled observations?", rows: [], picks: [],
    options: ["Dose curves", "Pooled observations"],
    decision: { question: "Compare the dose curves or the pooled observations?", options: [
      { label: "Dose curves", main: [1, 2] }, { label: "Pooled observations", main: [3] },
    ] },
  };
  let retryProposal: unknown;
  let repairedCuration: unknown;
  let promotionResponse: unknown = {promotion:null};
  const curationCalls: string[] = [];
  let focusRequest: { instruction: string; assets: unknown[] } | undefined;
  let repairRequest: { instruction: string; conversation: string[]; validation: unknown } | undefined;
  const app = createServer({
    dataDir: dir,
    aiFetch: async (_url, init) => {
      const wire = JSON.parse(String(init?.body));
      const content = wire.messages[1].content;
      let returned: unknown = response;
      const name = wire.response_format.json_schema.name;
      if (name === "FigureVisualReading") {
        visualCalls++;
        const items = [];
        for (let i = 0; i < content.length; i += 2) {
          const clue = JSON.parse(content[i].text);
          expect(Object.keys(clue).sort()).toEqual(["id", "script"]);
          expect(clue.script).toHaveProperty("category");
          expect(clue.script).toHaveProperty("svgText");
          expect(clue.script).toHaveProperty("ocrText");
          const encoded = content[i + 1].image_url.url;
          expect(encoded).toMatch(/^data:image\/jpeg;base64,/);
          const image = await sharp(Buffer.from(encoded.split(",")[1], "base64")).metadata();
          expect(image.width).toBeGreaterThan(0);
          exposed.push(clue.id);
          items.push({
            id: clue.id,
            category: "unknown",
            confidence: "low",
            text: [],
            observation: "Mixed marks",
          });
        }
        returned = { items };
      } else if (name === "FigureNameCheck") {
        returned = { conflicts: [] };
      } else if (name === "FigureCurationPromotion") {
        curationCalls.push(name);
        expect(wire.max_tokens).toBe(500);
        expect(wire.messages[0].content).toContain("Supplementary candidate numbers: 2.");
        expect(JSON.parse(content).assets[1]).toMatchObject({number:2,selected:false,imageReading:{source:"vision"}});
        returned = promotionResponse;
      } else if (name === "FigureCuration" || name === "FigureCurationDecision") {
        curationCalls.push(name);
        const curationInput = JSON.parse(content);
        if (wire.messages[0].content.includes("Revise the emphasis of an existing scientific figure"))
          focusRequest = { instruction:wire.messages[0].content, assets:curationInput.assets };
        if (name === "FigureCuration" && curationInput.panelStudioValidation) {
          repairRequest = {
            instruction: wire.messages[0].content,
            conversation: curationInput.conversation,
            validation: curationInput.panelStudioValidation,
          };
          if (repairedCuration !== undefined) returned = repairedCuration;
        }
        if (name === "FigureCurationDecision") returned = { decision:{
          question:"要看分剂量趋势，还是总体对比",
          options:[{label:"分剂量趋势",main:[1,2]},{label:"总体对比",main:[3]}],
        } };
      } else {
        expect(name).toBe("FigureSelection");
        expect(typeof content).toBe("string");
        seen.push(content);
        if (wire.messages[0].content.endsWith("Give your best proposal now. Use kind proposal and decision null."))
          returned = retryProposal;
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(returned) } }] });
    },
  });
  const key = () => ({ "idempotency-key": randomUUID() });
  try {
    const config = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/ai-provider",
      headers: key(),
      payload: {
        adapter: "openai-compatible",
        model: "test",
        baseUrl: "http://127.0.0.1:1/v1",
        allowLocalEndpoint: true,
        capabilities: { imageInput: true, structuredOutput: "json_schema" },
      },
    });
    expect(config.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/settings/ai-provider/secret",
          headers: key(),
          payload: { secret: "ephemeral-fixture" },
        })
      ).statusCode,
    ).toBe(200);
    const file = fileURLToPath(
      new URL("../../../examples/synthetic-six/synthetic-six.figurezip", import.meta.url),
    );
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/project-imports",
      headers: { ...key(), "content-type": "multipart/form-data; boundary=case" },
      payload: Buffer.concat([
        Buffer.from(
          '--case\r\nContent-Disposition: form-data; name="file"; filename="figure.figurezip"\r\nContent-Type: application/zip\r\n\r\n',
        ),
        readFileSync(file),
        Buffer.from("\r\n--case--\r\n"),
      ]),
    });
    const { result } = (await app.inject({ url: "/api/v1/jobs/" + imported.json().jobId })).json();
    const prefix = "/api/v1/projects/" + result.projectId,
      url = prefix + "/figure-discussion";
    const original = (await app.inject({ url: prefix + "/document" })).json().documentHash;
    const library = (await app.inject({ url: prefix + "/assets" })).json().items as { id: string }[];
    const [a, b] = library.map((v) => v.id) as [string, string];
    const payload = {
      assets: library.map((v) => ({ id: v.id, note: "author note", selected: false })),
      turns: ["Help me choose"],
      publication: { journal: "", field: "", message: "compare", preference: "comparison" },
      locale: "en-US",
      thumbnails: false,
    };
    const ask = () => app.inject({ method: "POST", url, payload });
    expect((await ask()).json()).toEqual({
      kind: "question", reply: "Compare the dose curves or the pooled observations?", rows: [], picks: [],
      options: ["Dose curves", "Pooled observations"],
    });
    expect(JSON.parse(seen[0]!).assets[0].imageReading.source).toBe("local");
    expect(visualCalls).toBe(0);
    payload.thumbnails = true;
    payload.turns.push("PanelStudio: Which comparison matters most?", "Compare two conditions.");
    response = {
      kind: "proposal",
      reply: "The pair covers the two conditions.",
      picks: [
        { id: a, reason: "Control" },
        { id: b, reason: "Comparison" },
      ],
      rows: [[a, b]],
    };
    expect((await ask()).json()).toMatchObject({
      reply: "Place #1, #2 side by side. The pair covers the two conditions.",
      rows: [[a, b]],
    });
    const c = library[2]!.id;
    response = {
      kind: "proposal",
      reply: "对比两组原始结果，并保留分组统计。",
      picks: [
        { id: b, reason: "group 2" },
        { id: a, reason: "group 1" },
        { id: c, reason: "summary" },
      ],
      rows: [[b, a], [c]],
    };
    payload.locale = "zh-CN";
    expect((await ask()).json()).toMatchObject({
      reply: "上排 #2、#1，下排 #3。对比两组原始结果，并保留分组统计。",
      rows: [[b, a], [c]],
    });
    payload.locale = "en-US";
    const wrongConnection = await app.inject({
      method: "POST",
      url: prefix + "/figure-readings",
      payload: { assetIds: [a], locale: "en-US", vision: true, configRevision: 99 },
    });
    expect(wrongConnection.statusCode).toBe(409);
    expect(new Set(exposed)).toEqual(new Set(library.map((item) => item.id)));
    expect(visualCalls).toBe(2 * Math.ceil(library.length / 3));
    expect(
      JSON.parse(seen[1]!).assets.every(
        (a: { imageReading: { source: string } }) => a.imageReading.source === "vision",
      ),
    ).toBe(true);
    response = {
      kind: "proposal",
      reply: "Invalid",
      picks: [{ id: randomUUID(), reason: "unavailable" }],
      rows: [[a]],
    };
    expect((await ask()).statusCode).toBe(422);
    response = {
      kind: "proposal",
      reply: "Invalid order",
      picks: [{ id: a, reason: "context" }],
      rows: [[b]],
    };
    expect((await ask()).statusCode).toBe(422);
    expect(visualCalls).toBe(2 * Math.ceil(library.length / 3));
    response = {
      kind: "question",
      reply: "有六张候选图。Fig. 2 更强调总体差异，还是差异随剂量的变化？确认后我再排版。",
      rows: [],
      picks: [],
      decision: {
        question: "有六张候选图。Fig. 2 更强调总体差异，还是差异随剂量的变化？确认后我再排版。",
        options: [{label:"总体差异",main:[3]},{label:"差异随剂量的变化",main:[1,2]}],
      },
    };
    payload.locale = "zh-CN";
    expect((await ask()).json().reply).toBe("Fig. 2 更强调总体差异，还是差异随剂量的变化？");
    response = {
      kind: "proposal",
      reply: "两组原始点可以直接比较。这里还有三种其他安排。",
      picks: [
        { id: a, reason: "first" },
        { id: b, reason: "second" },
      ],
      rows: [[a, b]],
    };
    expect((await ask()).json().reply).toBe("#1、#2 并排。两组原始点可以直接比较。");
    payload.turns.push("请详细解释");
    expect((await ask()).json().reply).toContain("这里还有三种其他安排。");
    retryProposal = response;
    response = {
      kind: "question", reply:"想让读者先看到什么？", rows:[], picks:[],
      options:["比较两组结果","展示变化趋势"],
      decision:{question:"想让读者先看到什么？", options:[
        {label:"比较两组结果",main:[1,2]}, {label:"展示变化趋势",main:[3]},
      ]},
    };
    expect((await ask()).json()).toMatchObject({kind:"proposal",rows:[[a,b]]});
    expect((await app.inject({ url: prefix + "/document" })).json().documentHash).toBe(original);
    response = {summary:"各剂量的观测",main:[{number:1,reason:"曲线一"},{number:2,reason:"曲线二"}],
      supplementary:[],rows:[[1,2]],decision:null,primaryNumber:null,suggestedSupplementary:null};
    const clarified = await app.inject({method:"POST",url,payload:{
      ...payload, turns:["我还没想好这张图要讲哪个比较。"], curation:{allowQuestion:true},
    }});
    expect(clarified.json()).toMatchObject({kind:"question",reply:"要看分剂量趋势，还是总体对比？",
      options:["分剂量趋势","总体对比"]});
    expect(curationCalls).toEqual(["FigureCuration","FigureCurationDecision"]);

    const all = [...library];
    for (let index = all.length; index < 10; index++) {
      const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="white"/><circle cx="${10 + index * 3}" cy="25" r="5" fill="blue"/></svg>`;
      const upload = await app.inject({method:"POST",url:prefix + "/assets",
        headers:{...key(),"content-type":"multipart/form-data; boundary=case"},
        payload:`--case\r\nContent-Disposition: form-data; name="file"; filename="panel-${index + 1}.svg"\r\nContent-Type: image/svg+xml\r\n\r\n${artwork}\r\n--case--\r\n`,
      });
      expect(upload.statusCode).toBe(202);
      const accepted = upload.json();
      expect((await app.inject({url:"/api/v1/jobs/" + accepted.jobId})).json().status).toBe("succeeded");
      all.push({id:accepted.assetId});
    }
    const askFull = () => app.inject({method:"POST",url,payload:{
      ...payload, turns:["请把这十张全用，第一张突出。"],
      assets:all.map(({id}) => ({id, note:"", selected:true})),
      curation:{allowQuestion:false,layoutAll:true},
    }});
    const fullPlan = {
      summary:"先看概览，再看它和其余结果的对应关系。",
      main:all.map((_,i) => ({number:i+1,reason:"展示其中一项数据"})),
      supplementary:[],rows:[[1],[2,3,4],[5,6,7],[8,9,10]], decision:null, primaryNumber:1,
    };
    response = fullPlan;
    const completeDraft = await askFull();
    expect(completeDraft.statusCode).toBe(200);
    expect(completeDraft.json()).toMatchObject({kind:"proposal",primaryId:a,supplementary:[],
      rows:fullPlan.rows.map(row => row.map(n => all[n-1]!.id)),
      picks:all.map(({id}) => ({id,reason:"展示其中一项数据"})),
    });
    response = {...fullPlan,main:fullPlan.main.slice(0,-1),rows:[[1],[2,3,4],[5,6,7],[8,9]]};
    expect((await askFull()).statusCode).toBe(422);
    response = {...fullPlan,primaryNumber:11};
    expect((await askFull()).statusCode).toBe(422);

    const focusInput = {
      ...payload,
      turns:["先比较两种方法的结果。","我想重点讲两种方法的一致性。"],
      assets:all.slice(0,4).map(({id},i) => ({id, note:"", selected:i !== 1})),
      curation:{allowQuestion:false,focusRevision:true},
    };
    const askFocus = (input: typeof focusInput & {curation:{layoutAll?: boolean}} = focusInput) =>
      app.inject({method:"POST",url,payload:input});
    const focusPlan = {
      summary:"先看两种方法的配对结果，再结合对照解释差异。",
      main:[{number:1,reason:"方法一结果"},{number:3,reason:"直接比较两种方法"},{number:4,reason:"提供对照"}],
      supplementary:[{number:2,reason:"补充分组背景"}],
      rows:[[3],[1,4]], decision:null, primaryNumber:3,
      suggestedSupplementary:[{number:1,reason:"方法一的单独视图"}],
    };
    const promotion = {
      number:2,
      question:"要把含对角参考线的配对散点图放进正文吗",
      accept:"加入配对散点图",
      keep:"沿用正文的对照图",
      reason:"配对散点可以看出两种方法的逐点偏差。",
    };
    response = focusPlan;
    promotionResponse = {promotion};
    const countBeforeQuestion = curationCalls.length;
    const question = await askFocus();
    expect(question.statusCode).toBe(200);
    expect(question.json()).toEqual({
      kind:"question",reply:"要把含对角参考线的配对散点图放进正文吗？",rows:[],picks:[],
      promotion:{
        id:b, question:"要把含对角参考线的配对散点图放进正文吗？",
        accept:promotion.accept, keep:promotion.keep, reason:promotion.reason,
      },
    });
    expect(curationCalls.slice(countBeforeQuestion)).toEqual(["FigureCurationPromotion"]);
    expect((await app.inject({url:prefix + "/document"})).json().documentHash).toBe(original);

    promotionResponse = {promotion:{...promotion,number:3}};
    const countBeforeFocus = curationCalls.length;
    const focus = await askFocus();
    expect(focus.statusCode).toBe(200);
    expect(curationCalls.slice(countBeforeFocus)).toEqual(["FigureCurationPromotion","FigureCuration"]);
    expect(focus.json()).not.toHaveProperty("promotion");
    const control = all[3]!.id;
    expect(focus.json()).toMatchObject({
      kind:"proposal",reply:focusPlan.summary,
      primaryId:c,rows:[[c],[a,control]],
      picks:[{id:a},{id:c},{id:control}],
      supplementary:[{id:b}],
      suggestedSupplementary:[{id:a,reason:"方法一的单独视图"}],
    });
    expect(focusRequest).toMatchObject({
      instruction:expect.stringContaining("The existing main panels are 1, 3, 4."),
      assets:[
        {number:1,selected:true,imageReading:{source:"vision",observation:"Mixed marks"}},
        {number:2,selected:false,imageReading:{source:"vision"}},
        {number:3,selected:true,imageReading:{source:"vision"}},
        {number:4,selected:true,imageReading:{source:"vision"}},
      ],
    });
    const countBeforeInvalidRequests = curationCalls.length;
    expect((await askFocus({
      ...focusInput, curation:{...focusInput.curation,layoutAll:true},
    })).statusCode).toBe(400);
    expect((await askFocus({
      ...focusInput, assets:focusInput.assets.map(asset => ({...asset,selected:false})),
    })).statusCode).toBe(400);
    expect(curationCalls).toHaveLength(countBeforeInvalidRequests);

    const countBeforeApproved = curationCalls.length;
    response = {
      ...focusPlan, main:[...focusPlan.main,{number:2,reason:"配对散点"}],
      supplementary:[], rows:[[2],[3],[1,4]], primaryNumber:2,
    };
    const approved = await askFocus({
      ...focusInput,
      turns:[...focusInput.turns,"把配对散点图加入正文，作为这次的重点。"],
      assets:focusInput.assets.map(asset => ({...asset,selected:true})),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({kind:"proposal",primaryId:b,supplementary:[]});
    expect(curationCalls.slice(countBeforeApproved)).toEqual(["FigureCuration"]);

    promotionResponse = {promotion:null};
    response = {...focusPlan,primaryNumber:2};
    repairedCuration = focusPlan;
    const repaired = await askFocus();
    expect(repaired.statusCode).toBe(200);
    expect(repaired.json()).toEqual(focus.json());
    expect(repairRequest).toEqual({
      instruction:expect.stringContaining("For this request, decision must be null."),
      conversation:focusInput.turns,
      validation:{
        error:expect.any(String),
        allowedNumbers:[1,2,3,4],
        requiredMain:[1,3,4],
        requiredSupplementary:[2],
        priorModelJson:JSON.stringify(response),
      },
    });
    const failedCalls = curationCalls.length;
    repairedCuration = undefined;
    response = {...focusPlan,primaryNumber:null};
    expect((await askFocus()).statusCode).toBe(422);
    expect(curationCalls.slice(failedCalls)).toEqual(["FigureCurationPromotion","FigureCuration","FigureCuration"]);
    expect((await app.inject({url:prefix + "/document"})).json().documentHash).toBe(original);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
