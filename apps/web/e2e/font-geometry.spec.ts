import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const metricsUrl = "/@fs/" + path.join(root, "packages/text-metrics/src/index.ts").replaceAll("\\", "/");

test("registered ink and advance agree with Chromium rendering the same SVG text", async ({ page }) => {
  await page.goto("/");
  const cases = await page.evaluate(async (url) => {
    const metrics: typeof import("../../../packages/text-metrics/src/index.js") = await import(url);
    await metrics.initializeLabelFonts();
    await document.fonts.ready;
    const samples = [
      { face: "noto-sans" as const, family: "Noto Sans", filename: "NotoSans-Regular.ttf", weight: 400 as const, texts: ["III", "WWW", "j", "AV", "   "] },
      { face: "noto-sans" as const, family: "Noto Sans", filename: "NotoSans-Bold.ttf", weight: 700 as const, texts: ["(Aβ)", "A\u0301"] },
      { face: "noto-sans-sc" as const, family: "Noto Sans SC", filename: "NotoSansSC-Regular.ttf", weight: 400 as const, texts: ["图(β)二"] },
      { face: "noto-sans-sc" as const, family: "Noto Sans SC", filename: "NotoSansSC-Bold.ttf", weight: 700 as const, texts: ["中文(A)"] },
    ];
    const output = [];
    for (const sample of samples) {
      const bytes = await (await fetch("/fonts/" + sample.filename)).blob();
      const fontUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(bytes);
      });
      for (const text of sample.texts) {
        const measured = metrics.measureLabel({ fontId: sample.face, fontWeight: sample.weight, fontSizePt:12, text });
        if (measured.status !== "measured") throw new Error("Cannot measure test label " + text);
        const width = 1200, height = 360, pxPerMm = 20, originX = 4, originY = 11;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width",String(width)); svg.setAttribute("height",String(height));
        svg.setAttribute("viewBox","0 0 60 18");
        const rendered = document.createElementNS(svg.namespaceURI!, "text") as SVGTextElement;
        rendered.setAttribute("x",String(originX)); rendered.setAttribute("y",String(originY));
        rendered.setAttribute("font-family", sample.family);
        rendered.setAttribute("font-size",String(12 * 25.4 / 72));
        rendered.setAttribute("font-weight",String(sample.weight));
        rendered.setAttributeNS("http://www.w3.org/XML/1998/namespace","xml:space","preserve");
        rendered.textContent = text; svg.append(rendered); document.body.append(svg);
        const advance = rendered.getComputedTextLength();
        const nativeBox = rendered.getBBox();
        const box = { x:nativeBox.x - originX, y:nativeBox.y - originY, width:nativeBox.width, height:nativeBox.height };
        // SVG getBBox includes font cells. Rasterizing the same SVG measures its actual visible ink.
        const embedded = document.createElementNS(svg.namespaceURI!, "style");
        embedded.textContent = `@font-face{font-family:'${sample.family}';font-weight:${sample.weight};src:url('${fontUri}') format('truetype')}`;
        svg.prepend(embedded);
        const resource = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:"image/svg+xml"}));
        svg.remove();
        const image = new Image();
        image.src = resource;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d", {willReadFrequently:true})!;
        ctx.drawImage(image,0,0); URL.revokeObjectURL(resource);
        const data = ctx.getImageData(0,0,width,height).data;
        let x0 = width, y0 = height, x1 = -1, y1 = -1;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (data[(y * width + x)*4+3]! < 32) continue;
          x0 = Math.min(x0,x); y0 = Math.min(y0,y); x1 = Math.max(x1,x); y1 = Math.max(y1,y);
        }
        const ink = x1 === -1 ? null : { x:x0/pxPerMm-originX, y:y0/pxPerMm-originY,
          width:(x1-x0+1)/pxPerMm, height:(y1-y0+1)/pxPerMm };
        output.push({text,weight:sample.weight,measured,advance,ink,box});
      }
    }
    return output;
  },metricsUrl);
  for (const {text,weight,measured,advance,ink,box} of cases) {
    const note = JSON.stringify({text,weight,measured,advance,ink,box});
    expect(Math.abs(advance - measured.advanceMm),note).toBeLessThan(0.03);
    expect(Boolean(ink),note).toBe(Boolean(measured.inkBoundsMm));
    if (!ink || !measured.inkBoundsMm) continue;
    for (const key of ["x","y","width","height"] as const) {
      expect(Math.abs(ink[key] - measured.inkBoundsMm[key]),note).toBeLessThan(0.11);
    }
    expect(ink.y,note).toBeGreaterThanOrEqual(box.y - 0.1);
    expect(ink.y + ink.height,note).toBeLessThanOrEqual(box.y + box.height + 0.1);
  }
});
