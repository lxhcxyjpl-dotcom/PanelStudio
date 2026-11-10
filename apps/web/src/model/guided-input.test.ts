import { describe, expect, it } from "vitest";
import { parsePreferences } from "./guided-preferences";
import { detectReference } from "./reference-image";

const units = ["A","B","C"].map((s) => ({id:s,name:s,alias:s}));
describe("preference review", () => {
  it("extracts independent Chinese and English instructions, custom labels and decimal millimetres", () => {
    expect(parsePreferences("突出B、A 和 C 放在一起，留白多一点",units)).toEqual({
      preferences:{focus:"B",pair:{first:"A",second:"C",axis:"any"},gapMm:6},unresolved:[]});
    expect(parsePreferences("highlight B, place A and C side by side, spacing 3.5 mm, landscape",units)).toEqual({
      preferences:{focus:"B",pair:{first:"A",second:"C",axis:"horizontal"},gapMm:3.5,shape:"wide"},unresolved:[]});
    expect(parsePreferences("强调空间图",[{id:"123",name:"空间图",alias:"空间图"}]).preferences.focus).toBe("123");
  });
  it("surfaces conflicts, unknown, negative, missing or ambiguous panel names without guessing", () => {
    expect(parsePreferences("紧凑，留白多一点，漂亮一点，不要突出 B",units)).toEqual({
      preferences:{},unresolved:["紧凑","留白多一点","漂亮一点","不要突出 B"]});
    expect(parsePreferences("突出Z", units).unresolved).toHaveLength(1);
    expect(parsePreferences("突出A", [...units,units[0]!]).unresolved).toHaveLength(1);
    expect(parsePreferences("我喜欢高级感", units).preferences).toEqual({});
  });
});

describe("reference region detection", () => {
  it("separates borderless plots along an observed white gutter", () => {
    const w=160, h=100, pixels=new Uint8ClampedArray(w*h*4).fill(255);
    for (const start of [5,102]) for (let y=10;y<90;y+=6) for (let x=start;x<start+50;x+=5) {
      for (let j=0;j<2;j++) for (let i=0;i<2;i++) pixels.fill(0,4*((y+j)*w+x+i),4*((y+j)*w+x+i)+3);
    }
    const result=detectReference(pixels,w,h,2);
    expect(result.method).toBe("gutters");
    expect(result.regions).toHaveLength(2);
    expect(result.regions[0]!.x + result.regions[0]!.width).toBeLessThan(.4);
    expect(result.regions[1]!.x).toBeGreaterThan(.6);
  });
  it("preserves independent outlined panels, drops nested boxes and returns no invented boxes on a blank page", () => {
    const w = 200, h = 140, data = new Uint8ClampedArray(w*h*4).fill(255);
    expect(detectReference(data,w,h,3).regions).toEqual([]);
    function outline(x:number,y:number,bw:number,bh:number) {
      for(let j=y;j<y+bh;j++) for(let i=x;i<x+bw;i++) if(i===x||j===y||i===x+bw-1||j===y+bh-1)
        data.fill(0,4*(j*w+i),4*(j*w+i)+3);
    }
    outline(2,8,75,62); outline(85,8,113,124); outline(2,76,75,56); outline(10,15,60,35);
    const regs = detectReference(data,w,h,3).regions;
    expect(regs.map((r) => [r.x*w,r.y*h])).toEqual([[2,8],[85,8],[2,76]]);
    expect(regs[1]!.height*h).toBe(124);
  });
});
