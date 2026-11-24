import { createDefaultFigureDocument } from "@panelstudio/contracts";
import { applyCommands } from "@panelstudio/core/apply";
import { expect, it } from "vitest";
import { placePanelCommands } from "./place";
import { interpretWish } from "./wish";

const figure = createDefaultFigureDocument();
const first = "11111111-1111-4111-8111-111111111111", second = "11111111-1111-4111-8111-111111111112";
const count = "22222222-2222-4222-8222-222222222221", points = "22222222-2222-4222-8222-222222222222";
const viewport = { width: 80, height: 60 };
const doc = applyCommands(figure, placePanelCommands(figure, [
  { panelId: first, assetId: count, viewport }, { panelId: second, assetId: points, viewport },
]), id => ({ id, originalFilename: id, viewport, rasterPixelSize: null }));
const prompt = "我想做figure two, 图宽85mm，把散点图放在左边。";
const scatter = { evidence: "散点图 Scatter plot", ignoreName: true };
const counts = { evidence: "条形图 Bar chart", ignoreName: true };

it("uses figure introductions, dictated dimensions and observed image type to order two panels", () => {
  const evidence = { [count]: counts, [points]: scatter };
  for (const intro of ["我想做figure two", "Fig. 2", "我要做第二张图"]) {
    expect(interpretWish(prompt.replace("我想做figure two", intro), doc, undefined, { evidence })).toEqual({
      kind: "layout", request: { family: "rows", rows: [["panel:" + second, "panel:" + first]], canvasOverride: { widthMm: 85 } },
    });
  }
  expect(interpretWish("我想做figure two", doc, undefined, { evidence }).kind).toBe("clarify");
  expect(interpretWish(prompt + "把散点图放在右侧。", doc, undefined, { evidence }).kind).toBe("clarify");
});

it("asks which image the author means when both are scatter plots", () => {
  expect(interpretWish(prompt, doc, undefined, { evidence: { [count]: scatter, [points]: scatter } })).toEqual({
    kind: "clarify", fragment: "把散点图放在左边",
  });
});
