import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { LayoutFamilySchema, LayoutRequestSchema } from "./layout.js";

const a = "panel:11111111-1111-4111-8111-111111111111", b = "group:22222222-2222-4222-8222-222222222222";
describe("local row request", () => {
  it("requires 2–3 distinct complete unit references and an explicit size mode", () => {
    const row = {family:"selection-row",orderedUnitIds:[a,b],sizing:"preserve"};
    expect(Check(LayoutFamilySchema,"selection-row")).toBe(true);
    expect(Check(LayoutRequestSchema,row)).toBe(true);
    expect(Check(LayoutRequestSchema,{...row,regionMm:{x:4,y:4,width:90,height:30},gapMm:0})).toBe(true);
    expect(Check(LayoutRequestSchema,{family:"selection-row"})).toBe(false);
    expect(Check(LayoutRequestSchema,{...row,orderedUnitIds:[a,a]})).toBe(false);
    expect(Check(LayoutRequestSchema,{...row,orderedUnitIds:[a]})).toBe(false);
    expect(Check(LayoutRequestSchema,{...row,gapMm:-1})).toBe(false);
    expect(Check(LayoutRequestSchema,{...row,canvasOverride:{widthMm:120}})).toBe(false);
  });
});
