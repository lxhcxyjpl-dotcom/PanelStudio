import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { FigureDocumentV1, FigureReading, LocalFigureEvidence } from "@panelstudio/contracts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const sharp = createRequire(path.join(root, "apps/server/package.json"))(
  "sharp",
) as typeof import("../../../apps/server/node_modules/sharp");
const xml = process.env.PANELSTUDIO_READING_CASE
  ? readFileSync(path.join(process.env.PANELSTUDIO_READING_CASE, "scan_03.svg"), "utf8")
  : '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="white"/><g font-family="sans-serif" fill="black"><text x="58" y="42" font-size="26">Mean difference at each dose</text><text x="238" y="397" font-size="20">Dose (mg/day)</text><text x="72" y="370">0.5</text><text x="289" y="370">1.0</text><text x="550" y="370">2.0</text></g><path d="M60 64V345H590" fill="none" stroke="black" stroke-width="2"/><polyline points="80,146 300,97 563,310" fill="none" stroke="#625077" stroke-width="3"/><g fill="#625077"><circle cx="80" cy="146" r="6"/><circle cx="300" cy="97" r="6"/><circle cx="563" cy="310" r="6"/></g></svg>';
const distribution = process.env.PANELSTUDIO_READING_CASE
  ? readFileSync(path.join(process.env.PANELSTUDIO_READING_CASE, "distribution-by-group.svg"), "utf8")
  : '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="white"/><text x="40" y="45">Empirical distribution</text><text x="300" y="390">Length</text><text x="35" y="83">Cumulative fraction</text><path d="M70 330h60v-45h100v-60h100v-80h160v-55h60" fill="none" stroke="blue"/><path d="M70 330h110v-55h75v-40h95v-60h120v-80h80" fill="none" stroke="red"/></svg>';
const treated = xml.replace(/Mean difference at each dose/g, "Treated only");
const act = (p: Page, n: string) => p.locator('[data-action="' + n + '"]:visible');
let host: Server, port: number, png: Buffer;
let calls = { visual: 0, check: 0, discussion: 0 },
  batches: { id: string; width: number; height: number; local: LocalFigureEvidence }[][] = [],
  effective: { filename: string; interpretedAs: string | null }[] = [];
let failVisual = false,
  correctLocalType = false;
test.beforeAll(async () => {
  png = await sharp(Buffer.from(xml), { density: 220 }).resize({ width: 1300 }).png().toBuffer();
  host = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on("data", (p) => parts.push(p));
    request.on("end", async () => {
      try {
        const wire = JSON.parse(Buffer.concat(parts).toString()),
          content = wire.messages[1].content;
        let result: unknown;
        const format = wire.response_format.json_schema.name;
        if (format === "FigureVisualReading") {
          calls.visual++;
          const batch = [],
            items = [];
          for (let i = 0; i < content.length; i += 2) {
            const v = JSON.parse(content[i].text);
            expect(Object.keys(v).sort()).toEqual(["id", "script"]);
            const data = content[i + 1].image_url.url;
            expect(data.startsWith("data:image/jpeg;base64,")).toBe(true);
            const meta = await sharp(Buffer.from(data.split(",")[1], "base64")).metadata();
            const local: LocalFigureEvidence = v.script,
              words = [...local.svgText, ...local.ocrText];
            batch.push({ id: v.id, width: meta.width!, height: meta.height!, local });
            const microscopy = local.category === "microscopy";
            items.push({
              id: v.id,
              category: correctLocalType ? "box" : microscopy ? "microscopy" : "line",
              confidence: microscopy ? "medium" : "high",
              text: words,
              observation: microscopy ? "Dark fluorescence field." : "Points joined by a visible line.",
            });
          }
          batches.push(batch);
          result = { items: failVisual ? [] : items };
        } else if (format === "FigureNameCheck") {
          calls.check++;
          const contrasts = JSON.parse(content) as Array<{ id: string; filename: string; visible: string[] }>;
          result = {
            conflicts: contrasts
              .filter((a) => a.filename.includes("Control") && a.visible.includes("Treated only"))
              .map((a) => ({ id: a.id, nameQuote: "Control", imageQuote: "Treated only" })),
          };
        } else {
          calls.discussion++;
          const req = JSON.parse(content);
          effective = req.assets;
          const available = req.assets as {
            id: string;
            imageReading: { visibleText?: string[]; text?: string[] };
          }[];
          const paired = available.find((a) =>
            JSON.stringify(a.imageReading).includes("Empirical distribution"),
          );
          const picks = paired ? [available[0]!, paired] : available.slice(0, 2);
          result = {
            kind: "proposal",
            reply: paired
              ? "用均值差图展示各剂量下的组间差异，再用两组的累积分布补充整体分布。"
              : "选这两张展示剂量趋势。",
            picks: picks.map((a) => ({
              id: a.id,
              reason: a.id === paired?.id ? "两组的累积分布" : "各剂量下两组的均值差",
            })),
            rows: [picks.map((a) => a.id)],
          };
        }
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
      } catch {
        response.statusCode = 500;
        response.end();
      }
    });
  });
  host.listen(0, "127.0.0.1");
  await once(host, "listening");
  const addr = host.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});
test.afterAll(() => host.close());
test.beforeEach(async ({ page }) => {
  calls = { visual: 0, check: 0, discussion: 0 };
  batches = [];
  effective = [];
  failVisual = false;
  correctLocalType = false;
  const config = {
    adapter: "openai-compatible",
    model: "fixture-vision",
    baseUrl: "http://127.0.0.1:" + port + "/v1",
    allowLocalEndpoint: true,
    capabilities: { imageInput: true, structuredOutput: "json_schema" },
  };
  expect(
    (
      await page.request.put("/api/v1/settings/ai-connection", {
        data: { config, secret: "test-only-fixture" },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() =>
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ locale: "zh-CN", theme: "light", motion: "on" }),
    ),
  );
});
async function upload(page: Page, withConflict: boolean) {
  await page.goto("/");
  await expect(page.getByTestId("use-image-model").filter({ visible: true })).toBeChecked();
  await page.getByTestId("start-brief").filter({ visible: true }).fill("帮我选图，比较两组的剂量反应");
  const file = page.waitForEvent("filechooser");
  await act(page, "empty-import").click();
  const assets = [
    { name: withConflict ? "heatmap.png" : "scan_01.png", mimeType: "image/png", buffer: png },
    { name: "scan_03.svg", mimeType: "image/svg+xml", buffer: Buffer.from(xml) },
    {
      name: "IMG_001.png",
      mimeType: "image/png",
      buffer: readFileSync(path.join(root, "examples/showcase/assets/microscopy-green.png")),
    },
  ];
  if (withConflict)
    assets.push(
      { name: "Control-line.svg", mimeType: "image/svg+xml", buffer: Buffer.from(treated) },
      { name: "scan_07.svg", mimeType: "image/svg+xml", buffer: Buffer.from(distribution) },
    );
  await (await file).setFiles(assets);
  await act(page,"start-send").click();
  await expect(page).toHaveURL(/\/app\/[a-f0-9-]+$/);
}
test("reads the image before its name, asks once per contradiction and resumes the original wish after reload", async ({
  page,
}, info) => {
  await upload(page, true);
  const question = page.getByTestId("figure-identity");
  await expect(question).toContainText("heatmap.png", { timeout: 40000 });
  await expect(question).toContainText("折线图");
  expect(calls.discussion).toBe(0);
  expect(calls.visual).toBe(2);
  const flat = batches.flat();
  const pixels = flat.find((x) => x.local.ocrText.some((t) => t.includes("Mean difference")));
  expect(pixels?.width).toBeGreaterThan(1000);
  expect(pixels?.local.category).toBe("line");
  expect(flat.some((x) => x.local.svgText.includes("Mean difference at each dose"))).toBe(true);
  await page.screenshot({ path: info.outputPath("01-文件名与图不符.png") });
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  for(const name of ["identity-image","identity-filename","identity-custom"]){
    await expect(act(page,name)).toBeInViewport();
  }
  await page.screenshot({path:info.outputPath("01-手机确认.png")});
  await page.setViewportSize({width:1440,height:900});
  await act(page, "inspect-conflict").click();
  await expect(page.getByRole("dialog").locator("img")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await act(page, "identity-image").click();
  await expect(question).toContainText("Control-line.svg");
  await page.reload();
  await expect(question).toContainText("Treated only");
  await act(page, "identity-custom").click();
  await page.getByRole("textbox", { name: "我来说明" }).fill("经作者核实的治疗组");
  await act(page, "identity-save").click();
  await expect(question).toHaveCount(0);
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(2, { timeout: 20000 });
  expect(calls.visual).toBe(2);
  expect(calls.discussion).toBe(1);
  expect(effective.find((a) => a.filename === "heatmap.png")?.interpretedAs).toBe("折线图");
  expect(effective.find((a) => a.filename === "Control-line.svg")?.interpretedAs).toBe("经作者核实的治疗组");
  await page.reload();
  await page.getByRole("button", { name: "查看大图：heatmap.png", exact: true }).click();
  const details = page.getByRole("dialog").locator(".figure-reading-details");
  await details.locator("summary").click();
  await expect(details).toContainText("Dose (mg/day)");
  await act(page, "revise-identity").click();
  await expect(question).toContainText("heatmap.png");
  await act(page, "identity-filename").click();
  await expect(question).toHaveCount(0);
  await page.getByTestId("wish-input").fill("再看一次组合");
  await act(page, "wish-send").click();
  await expect.poll(() => calls.discussion).toBe(2);
  expect(calls.visual).toBe(2);
  expect(effective.find((a) => a.filename === "heatmap.png")?.interpretedAs).toBe("heatmap");
  await page.getByRole("button", { name: "查看大图：heatmap.png", exact: true }).click();
  await page.getByRole("dialog").locator(".figure-reading-details summary").click();
  await act(page, "revise-identity").click();
  await act(page, "identity-image").click();
  await expect(question).toHaveCount(0);
  const base = "/api/v1/projects/" + new URL(page.url()).pathname.split("/").at(-1);
  const req = await page.request.post(base + "/figure-readings", {
    data: { assetIds: flat.map((item) => item.id), vision: false, preferSaved: true, locale: "zh-CN" },
  });
  const saved = (await req.json()).items as FigureReading[];
  expect(saved.filter((r) => r.decision)).toHaveLength(2);
  const stale = await page.request.put(base + "/assets/" + saved[0]!.id + "/figure-identity", {
    data: { choice: "custom", value: "stale attempt", fingerprint: "0".repeat(64) },
  });
  expect(stale.status()).toBe(409);
  await page.screenshot({ path: info.outputPath("02-继续选图.png") });
  await page.getByTestId("wish-input").fill("两张并排，整张宽 85 mm");
  await act(page, "wish-draft").click();
  const document = async (): Promise<FigureDocumentV1> =>
    (await (await page.request.get(base + "/document")).json()).document;
  await expect.poll(async () => (await document()).canvas.widthMm).toBe(85);
  const draft = await document(),
    panel = draft.panelOrder[1]!;
  await page.getByTestId("wish-input").fill("把 B 缩小 10%");
  await act(page, "wish-send").click();
  await expect
    .poll(async () => (await document()).panels[panel]!.frameMm.width)
    .toBeCloseTo(draft.panels[panel]!.frameMm.width * 0.9, 5);
  await page.reload();
  await expect(page.locator(".panel-frame")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("03-投稿排版.png") });
  await act(page, "export").click();
  const receive = page.waitForEvent("download");
  await act(page, "export-svg").click();
  const exported = info.outputPath("Fig2-85mm.svg");
  await (await receive).saveAs(exported);
  const svg = readFileSync(exported, "utf8");
  expect(svg).toContain('width="85mm"');
  expect(svg).toContain("Empirical distribution");
  expect(svg).toContain("<image");
  expect(calls.visual).toBe(2);
  writeFileSync(
    info.outputPath("视觉接口验收.json"),
    JSON.stringify(
      { provider: "local controlled visual endpoint", calls, batches, readings: saved },
      null,
      2,
    ),
  );
});
test("an author can keep working locally when another tab turns off cloud reading during a question", async ({
  page,
}) => {
  await upload(page, true);
  const question = page.getByTestId("figure-identity");
  await expect(question).toContainText("heatmap.png", { timeout: 40000 });
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.evaluate(() => localStorage.setItem("panelstudio.visual-reading", "off"));
  await other.close();
  await act(page, "identity-image").click();
  await expect(question).toContainText("Control-line.svg");
  await act(page, "identity-filename").click();
  await expect(question).toHaveCount(0);
  await expect(page.locator("[data-asset-choice]")).toHaveCount(5);
  expect(calls.discussion).toBe(0);
  expect(calls.visual).toBe(2);
});
test("a visual model can override the script's provisional classification", async ({ page }) => {
  correctLocalType = true;
  await upload(page, false);
  await expect.poll(() => calls.discussion, { timeout: 40000 }).toBe(1);
  const item = batches.flat().find((v) => v.local.category === "line")!;
  const base = "/api/v1/projects/" + new URL(page.url()).pathname.split("/").at(-1);
  const result = await page.request.post(base + "/figure-readings", {
    data: { assetIds: [item.id], vision: true, locale: "zh-CN" },
  });
  expect((await result.json()).items[0]).toMatchObject({
    source: "vision",
    category: "box",
    local: { category: "line" },
    conflict: null,
  });
});
test("a failed visual read keeps the wish and can retry without guessing from filenames", async ({
  page,
}) => {
  failVisual = true;
  await upload(page, false);
  const input = page.getByTestId("wish-input");
  await expect(input).toHaveValue("帮我选图，比较两组的剂量反应", { timeout: 40000 });
  await expect(page.getByTestId("wish-workbench")).toContainText(/模型/);
  expect(calls.discussion).toBe(0);
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(0);
  failVisual = false;
  await act(page, "wish-send").click();
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(2, { timeout: 30000 });
});
