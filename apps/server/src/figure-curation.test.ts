import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { FigureReading } from "@panelstudio/contracts";
import { designCheckNumbers, resolveCurationPlan } from "./figure-curation.js";

const readings = Array.from({length:5},(): FigureReading => ({
  id:randomUUID(), fingerprint:"a".repeat(64), source:"vision", category:"scatter", confidence:"high",
  text:[], observation:"observed marks", conflict:null, decision:null,
  local:{category:"unknown",confidence:"low",svgText:[],ocrText:[],ocrStatus:"not-needed",cues:[]},
}));
const plan = {
  summary:"比较两组的分剂量观测值。",
  main:[{number:1,reason:"OJ 的分剂量原始点"},{number:2,reason:"VC 的分剂量原始点"}],
  supplementary:[{number:4,reason:"核对各组样本量"}],
  rows:[[1,2]],
  decision:null,
};

it("only asks when the answers would select different available main panels, then returns the draft", () => {
  const question = "想看剂量趋势，还是合并后的组间差异？";
  const options = [{label:"各剂量的趋势",main:[1,2]}, {label:"合并后的组间差异",main:[3]}];
  const answer = resolveCurationPlan({...plan,decision:{question,options}},readings,"zh-CN",true);
  expect(answer).toMatchObject({kind:"question",reply:question,options:options.map(item=>item.label),picks:[]});
  for (const rejected of [
    {...options[1],main:[2,1]},
    {...options[1],main:[9]},
  ]) {
    expect(resolveCurationPlan({...plan,decision:{question,options:[options[0],rejected]}},readings,"zh-CN",true).kind).toBe("proposal");
  }
  expect(resolveCurationPlan({...plan,decision:{question,options}},readings,"zh-CN",false)).toMatchObject({
    kind:"proposal",
    rows:[[readings[0]!.id,readings[1]!.id]],
    supplementary:[{id:readings[3]!.id,reason:"核对各组样本量"}],
  });
});

it("defers a conflicting filename unless the affected image is in the main draft and rejects invalid assignments", () => {
  const mismatch = {nameQuote:"Control",imageQuote:"Treated only"};
  const withConflict = (n: number) => readings.map((entry,i)=>i===n ? {...entry,conflict:mismatch} : entry);
  expect(resolveCurationPlan(plan,withConflict(3),"zh-CN",true).kind).toBe("proposal");
  expect(resolveCurationPlan(plan,withConflict(0),"zh-CN",true)).toMatchObject({
    kind:"question",identity:{id:readings[0]!.id,conflict:mismatch},
  });
  const confirmed = withConflict(0);
  confirmed[0]!.decision = {choice:"image",value:mismatch.imageQuote};
  expect(resolveCurationPlan(plan,confirmed,"zh-CN",false).kind).toBe("proposal");
  expect(() => resolveCurationPlan({...plan,supplementary:[{number:2,reason:"duplicate"}]},readings,"zh-CN",true)).toThrow();
  expect(() => resolveCurationPlan({...plan,rows:[[1,4]]},readings,"zh-CN",true)).toThrow();
});

it("keeps explicitly labelled sample counts as supporting checks rather than mistaking them for response data",()=>{
  const labeled = readings.map((entry,index)=>index===3 ? {...entry,text:["Observations per cell"]} : entry);
  const draft = {...plan,main:[...plan.main,...plan.supplementary],supplementary:[],rows:[[1,2],[4]]};
  const alternatives = {question:"要加样本数吗？",options:[{label:"含样本数",main:[1,2,4]},{label:"直接看数据",main:[1,2]}]};
  const checks=designCheckNumbers(labeled,"比较各剂量结果");
  expect(resolveCurationPlan({...draft,decision:alternatives},labeled,"zh-CN",true,checks)).toMatchObject({
    kind:"proposal",picks:plan.main.map(pick=>({id:readings[pick.number-1]!.id})),rows:[[readings[0]!.id,readings[1]!.id]],
    supplementary:[{id:readings[3]!.id}],
  });
  expect(designCheckNumbers(labeled,"这次要展示样本量")).toEqual(new Set());
  expect(designCheckNumbers(labeled.map(entry=>({...entry,text:["Immune cell count"]})),"比较细胞计数")).toEqual(new Set());
});

it("changes the emphasis while preserving the existing main and supplementary memberships", () => {
  const currentMain = new Set([1, 2, 4]);
  const draft = {
    summary: "先看两组在各剂量的观测分布。",
    main: [...plan.main, ...plan.supplementary],
    supplementary: [{number:5,reason:"对照数据"},{number:3,reason:"汇总各剂量"}],
    primaryNumber: 2,
    rows: [[2,1],[4]],
    decision: {question:"需要显示样本量吗？",options:[{label:"保留样本量",main:[1,2,4]},{label:"聚焦观测值",main:[1,2]}]},
    suggestedSupplementary: [
      {number:4,reason:"只用于核对样本量"},
      {number:4,reason:"重复建议"},
      {number:2,reason:"主视图不能成为建议"},
      {number:3,reason:"已经在补充图"},
      {number:9,reason:"不在项目中"},
    ],
  };
  const labeled = readings.map((entry,index) => index === 3
    ? {...entry,text:["Observations per cell"],conflict:{nameQuote:"Control",imageQuote:"Observations per cell"}}
    : entry);
  const checks = designCheckNumbers(labeled,"比较各剂量结果");
  const revise = (raw: unknown) => resolveCurationPlan(raw,labeled,"zh-CN",true,checks,false,currentMain);
  expect(revise(draft)).toEqual({
    kind:"proposal",
    reply:draft.summary,
    primaryId:readings[1]!.id,
    rows:[[readings[1]!.id,readings[0]!.id],[readings[3]!.id]],
    picks:draft.main.map(entry => ({id:readings[entry.number-1]!.id,reason:entry.reason})),
    supplementary:[{id:readings[2]!.id,reason:"汇总各剂量"},{id:readings[4]!.id,reason:"对照数据"}],
    suggestedSupplementary:[{id:readings[3]!.id,reason:"只用于核对样本量"}],
  });
  expect(() => revise({
    ...draft, main:plan.main, rows:[[2,1]], supplementary:[...draft.supplementary,...plan.supplementary],
  })).toThrow();
  expect(() => revise({
    ...draft, main:[...plan.main,draft.supplementary[1]], rows:[[2,1],[3]],
    supplementary:[...plan.supplementary,draft.supplementary[0]],
  })).toThrow();
  expect(() => revise({...draft,supplementary:draft.supplementary.slice(0,1)})).toThrow();
  expect(() => revise({...draft,primaryNumber:undefined})).toThrow();
});
