import { createDefaultFigureDocument, type DomainCommand } from "@panelstudio/contracts";
import { describe, expect, it } from "vitest";
import { applyCommands, assertFigureDocument, hashFigureDocument, labelDiagnostics, resolvePanelLabel } from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const assets = () => ({ id: assetId, viewport: { width: 100, height: 100 }, originalFilename: "image", rasterPixelSize: null });
function legacy() {
  const frameMm = { x: 10, y: 10, width: 20, height: 20 };
  const d = applyCommands(createDefaultFigureDocument(), [{ type:"panel.add", panelId: id, assetId, frameMm }], assets);
  d.panels[id]!.labelOverrides.offsetMm = { x:-12, y:-8 };
  return d;
}
function move(x: number, y: number): DomainCommand {
  return { type:"panel.setFrames", items: [{panelId:id, frameMm:{x, y, width:20, height:20}}] };
}

describe("non-destructive legacy label validation", () => {
  it("diagnoses existing overflow without moving the panel or changing the hash", () => {
    const d = legacy(), hash = hashFigureDocument(d);
    expect(() => assertFigureDocument(d, assets)).not.toThrow();
    expect(labelDiagnostics(d)).toMatchObject([{code:"OUTSIDE_CANVAS", panelIds:[id]}]);
    expect(hashFigureDocument(d)).toBe(hash);
    expect(labelDiagnostics(applyCommands(d, [move(13, 13)], assets))).toEqual([]);
  });
  it("never trades smaller horizontal overflow for more top overflow", () => {
    const d = legacy();
    expect(() => applyCommands(d, [move(13, 9)], assets)).toThrow(expect.objectContaining({code:"OUTSIDE_CANVAS"}));
  });
  it("requires a newly visible label to fit even if its hidden offset is old", () => {
    const d = legacy(), o = d.panels[id]!.labelOverrides;
    o.visible = false;
    expect(() => applyCommands(d, [{type:"label.setOverrides", items:[{panelId:id, value:{...o,visible:true}}]}], assets))
      .toThrow(expect.objectContaining({code:"OUTSIDE_CANVAS"}));
  });
  it("keeps a legacy missing glyph through unrelated edits and permits a face repair", () => {
    const d = legacy(), o = d.panels[id]!.labelOverrides;
    o.text = "图"; o.offsetMm = {x:1,y:5};
    expect(labelDiagnostics(d)[0]).toMatchObject({code:"TEXT_METRICS_UNAVAILABLE", params:{characters:"图"}});
    expect(() => applyCommands(d, [{type:"panel.rename",panelId:id,name:"New"}], assets)).not.toThrow();
    expect(() => applyCommands(d, [move(11, 10)], assets)).toThrow(expect.objectContaining({code:"TEXT_METRICS_UNAVAILABLE"}));
    const repaired = applyCommands(d, [{type:"label.setStyle",labelStyle:{...d.labelStyle,fontId:"noto-sans-sc"}}],assets);
    expect(resolvePanelLabel(repaired,id)?.measurement.status).toBe("measured");
    expect(labelDiagnostics(repaired)).toEqual([]);
  });
});
