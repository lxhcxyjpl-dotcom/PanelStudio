import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { uiFontSizes } from "@panelstudio/ui";

const action = (page: Page, name: string) => page.locator(`[data-action="${name}"]`);
async function preferences(page: Page, locale = "zh-CN", theme = "light", motion = "on") {
  await page.addInitScript(prefs => localStorage.setItem("panelstudio.prefs", JSON.stringify(prefs)), { locale, theme, motion });
}
async function sample(page: Page, index = 0) {
  await action(page, "home-gallery").click();
  await action(page, "open-scientific-example").nth(index).click();
  await expect(page.locator(".panel-frame").first()).toBeVisible();
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1)!;
}
async function home(page: Page) {
  await action(page, "project-menu").click();
  await action(page, "return-home").click();
  await expect(page.getByTestId("home-page")).toBeVisible();
}
async function snapshot(page: Page, id: string) { return (await page.request.get(`/api/v1/projects/${id}/document`)).json(); }
async function boundsAndType(page: Page) {
  const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
    sizes: [...new Set([...document.body.querySelectorAll("*")].flatMap(node => {
      if (!(node instanceof HTMLElement) || node.closest(".paper,svg,[hidden],[inert],[aria-hidden=true],.sr-only") || !node.getClientRects().length || getComputedStyle(node).visibility !== "visible") return [];
      return node.matches("textarea,select,input:not([type=checkbox],[type=radio],[type=file],[type=hidden])") || [...node.childNodes].some(c => c.nodeType === 3 && c.textContent?.trim()) ? [parseFloat(getComputedStyle(node).fontSize)] : [];
    }))] }));
  expect(result.overflow).toBeLessThanOrEqual(0);
  expect(Object.values(uiFontSizes)).toEqual(expect.arrayContaining(result.sizes));
}

for (const [width, height, locale, theme] of [[1440,900,"zh-CN","light"], [1280,800,"en-US","light"], [1024,768,"zh-CN","dark"], [390,844,"en-US","dark"], [320,740,"zh-CN","light"]] as const) {
  test(`editorial home and editor at ${width}, ${locale}, ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await preferences(page, locale, theme); await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByTestId("home-page")).toBeVisible();
    const papers = page.getByTestId("hero-showcase").locator(".hero-paper");
    await expect(papers).toHaveCount(3);
    await expect(papers.locator("img")).toHaveCount(3);
    await expect(page.getByTestId("demo-stage")).toBeHidden();
    await expect(action(page, "hero-playback")).toBeHidden();
    await action(page, "choose-example").nth(2).focus();
    await page.keyboard.press("Enter");
    await expect(papers.nth(2)).toHaveAttribute("data-role", "front");
    await expect(papers.nth(2)).toHaveCSS("opacity", "1");
    await expect(papers.nth(1)).toHaveCSS("opacity", "0.42");
    await action(page, "choose-example").first().click();
    await expect(page.locator(".brand-intro h1")).toHaveCSS("font-size", width < 768 ? "24px" : "56px");
    await expect.poll(() => papers.locator("img").evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await boundsAndType(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath("home.png"), fullPage: true });
    const id = await sample(page);
    const initial = await snapshot(page,id);
    await expect(page.locator(".paper")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await boundsAndType(page);
    await page.screenshot({ path: info.outputPath("editor.png") });
    if (width < 1024) await action(page,"mobile-properties").click();
    await expect(page.getByTestId("right-sidebar")).toBeVisible();
    await boundsAndType(page);
    if (width < 1024) await action(page,"close-inspector").click();
    expect((await snapshot(page,id)).documentHash).toBe(initial.documentHash);
    expect(errors).toEqual([]);
  });
}

test("real recorded geometry plays once, pauses, compares and exports the demonstrated SVG", async ({ page }) => {
  await preferences(page,"en-US","light","off"); await page.goto("/");
  const choices = action(page,"choose-example");
  await expect(choices.nth(0)).toHaveAttribute("aria-pressed","true");
  await expect(choices.nth(1)).toHaveAttribute("aria-pressed","true", {timeout:9000});
  await action(page,"hero-playback").click();
  await page.waitForTimeout(5700); await expect(choices.nth(1)).toHaveAttribute("aria-pressed","true");
  await action(page,"home-gallery").click();
  await page.locator("#laboratory").scrollIntoViewIfNeeded();
  await action(page,"demo-step").nth(0).click();
  await expect(page.getByTestId("demo-source-panels").locator("img")).toHaveCount(6);
  await action(page,"demo-playback").click();
  await expect(page.getByTestId("demo-stage")).toHaveAttribute("data-step","1", {timeout:5000});
  await expect(page.getByTestId("demo-stage").locator("svg.recorded-figure")).toBeVisible();
  await action(page,"demo-step").nth(6).click();
  const figure = page.getByTestId("demo-stage").locator("svg.recorded-figure");
  const refined = await figure.getAttribute("data-document-hash");
  await action(page,"demo-original").click();
  expect(await figure.getAttribute("data-document-hash")).not.toBe(refined);
  await action(page,"demo-draft").click(); await expect(figure).toHaveAttribute("data-document-hash",refined!);
  await page.waitForTimeout(3000); await expect(page.getByTestId("demo-stage")).toHaveAttribute("data-step","6");
  const svg = await page.request.get(await page.locator('.replay-navigation a[download]').getAttribute("href") as string);
  expect(svg.ok()).toBe(true); expect(await svg.text()).toContain("<svg");
});

test("home, browser history and deep links preserve the editing session; examples are separate projects", async ({ page }) => {
  await preferences(page); await page.goto("/"); const first = await sample(page);
  const saved = await snapshot(page,first);
  await action(page,"zoom-in").click();
  const transform = await page.locator(".paper").getAttribute("style");
  await action(page,"tab-ai").click(); await page.getByTestId("ai-prompt").fill("保留尚未发送的精修要求");
  await home(page);
  await page.goBack(); await expect(page).toHaveURL(new RegExp(first+"$"));
  await expect(page.getByTestId("ai-prompt")).toHaveValue("保留尚未发送的精修要求");
  await expect(page.locator(".paper")).toHaveAttribute("style",transform!);
  await page.goForward(); await expect(page.getByTestId("home-page")).toBeVisible();
  const second = await sample(page,1); expect(second).not.toBe(first);
  expect((await snapshot(page,first)).documentHash).toBe(saved.documentHash);
  await page.reload(); await expect(page).toHaveURL(new RegExp(second+"$"));
  await expect(page.locator(".panel-frame")).toHaveCount(3);
  await page.goto("/app/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("alert")).toContainText("暂时无法打开图稿");
  await action(page,"route-home").click();
  await expect(page.getByTestId("home-page")).toBeVisible();
  await page.locator(".brand-resume").click(); await expect(page).toHaveURL(new RegExp(second+"$"));
});

test("crop and unsaved edits prevent navigation until resolved, including browser Back", async ({ page }) => {
  await preferences(page); await page.goto("/"); const id = await sample(page);
  await page.locator(".panel-frame").first().click(); await action(page,"enter-crop").click();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(id+"$"));
  await expect(page.getByRole("status").filter({hasText:"请先完成或取消当前裁剪"})).toBeVisible();
  await action(page,"crop-cancel").click();
  await page.route("**/api/v1/projects/*/transactions",route=>route.abort());
  await page.getByTestId("canvas").focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog")).toBeVisible();
  await action(page,"close-dialog").click();
  await action(page,"project-menu").click(); await action(page,"return-home").click();
  await expect(page).toHaveURL(new RegExp(id+"$")); await expect(page.getByRole("dialog")).toBeVisible();
  await page.unroute("**/api/v1/projects/*/transactions");
  await page.getByRole("button",{name:"重试保存",exact:true}).click();
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  await home(page); await page.locator(".brand-resume").click();
  await expect(page.locator(".panel-frame")).toHaveCount(6);
});

test("inspector candidates preserve the viewport, readonly previews and saved export revision", async ({ page }, info) => {
  await preferences(page); await page.goto("/"); const id = await sample(page);
  const original = await snapshot(page,id), before = await page.getByTestId("canvas").boundingBox();
  await page.getByTestId("layout-button").click();
  await expect(page.getByTestId("candidate-card").first()).toBeVisible();
  expect(await page.getByTestId("canvas").boundingBox()).toEqual(before);
  await page.getByTestId("candidate-card").last().click();
  await action(page,"tab-properties").click();
  await expect(page.getByTestId("right-sidebar").locator("fieldset.property-content")).toHaveAttribute("disabled", "");
  await expect(page.getByTestId("right-sidebar").locator("fieldset.property-content input").first()).toBeDisabled();
  await page.getByTestId("export-button").click();
  await expect(page.getByTestId("export-revision")).toContainText(String(original.revision));
  for (const format of ["svg","png","project"] as const) {
    await action(page,"format-"+format).click();
    await expect(action(page,"download-again")).toBeHidden();
    await expect(page.getByTestId("export-revision")).toBeVisible();
    await expect(page.getByTestId("export-revision")).toContainText(`草案未应用，将导出已保存版本 ${original.revision}`);
    await expect(page.getByTestId("font-status")).toBeHidden();
    if (format === "svg") {
      const rasterHint = page.getByText(/栅格子图保留为独立图片/);
      await expect(rasterHint).toBeHidden(); await page.locator(".export-font-details summary").click();
      await expect(rasterHint).toBeVisible(); await expect(action(page,"download-fonts")).toBeVisible();
    }
    const {widthMm,heightMm} = original.document.canvas;
    const pixels = [widthMm,heightMm].map(mm => Math.round(mm * 300 / 25.4));
    if (format === "png") {
      await page.getByLabel("PNG 分辨率").selectOption("300");
      await expect(page.getByTestId("export-dimensions")).toHaveText(`预计 ${pixels.join(" × ")} px`);
    }
    const downloadPromise=page.waitForEvent("download"); await action(page,"export-"+format).click();
    const file=await downloadPromise, dest=info.outputPath(file.suggestedFilename()); await file.saveAs(dest);
    expect(readFileSync(dest).byteLength).toBeGreaterThan(100);
    if (format === "svg") {
      const svg = readFileSync(dest,"utf8"); expect(svg).toContain("<text");
      const meta = await page.evaluate(text => JSON.parse(new DOMParser().parseFromString(text,"image/svg+xml").querySelector("metadata")!.textContent!), svg);
      expect(meta.revision).toBe(original.revision);
    } else if (format === "png") {
      const bytes = readFileSync(dest); expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(pixels);
    }
    await expect(action(page,"download-again")).toBeVisible();
  }
  expect((await snapshot(page,id)).documentHash).toBe(original.documentHash);
});

for (const width of [1440, 320]) test(`compares real artwork, reopens kept candidates and discards without committing at ${width}`, async ({page}) => {
  await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
  await preferences(page); await page.goto("/"); const id = await sample(page), saved = await snapshot(page,id);
  await action(page,"guided-layout").click(); await page.getByTestId("guide-words").fill("间距 4 mm");
  await action(page,"generate-guided").click();
  const cards = page.getByTestId("candidate-card");
  await expect(cards.first()).toContainText("2 行 · 每行 3 图");
  await expect(cards.nth(1)).toContainText("3 行 · 每行 2 图");
  await expect(cards.first().locator("img")).toBeVisible();
  const ratios = await cards.first().locator("img").evaluate(img => {
    const {width:w,height:h} = img.getBoundingClientRect();
    return [w/h, img.naturalWidth/img.naturalHeight];
  });
  expect(ratios[0]).toBeCloseTo(ratios[1]!, 1);
  await boundsAndType(page); await expect(action(page,"apply-layout")).toBeInViewport();
  await cards.nth(1).click(); await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button",{name:"保留候选，返回编辑"}).click();
  await expect(page.locator(".board-info strong")).toHaveText("画板");
  if (width < 768) await action(page,"mobile-properties").click();
  await page.getByRole("tab",{name:"候选版式"}).click();
  await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".board-info strong")).toHaveText("布局预览");
  await page.getByRole("button",{name:"丢弃候选"}).click();
  await expect(action(page,"tab-layout")).toHaveCount(0);
  expect((await snapshot(page,id)).documentHash).toBe(saved.documentHash);
  expect((await snapshot(page,id)).revision).toBe(saved.revision);
});

test("cancelling layout before the server replies cannot reopen a discarded preview", async ({ page }) => {
  await preferences(page); await page.goto("/"); const id = await sample(page), saved = await snapshot(page,id);
  let release!: () => void;
  const waitForCancel = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/layout-candidates", async route => { const response = await route.fetch(); await waitForCancel; await route.fulfill({response}); });
  try {
    await page.getByTestId("layout-button").click();
    await expect(page.getByText("正在计算布局候选", {exact:true})).toBeVisible();
    await action(page,"cancel-layout").click();
    const done = page.waitForResponse(response => response.url().endsWith("/layout-candidates"));
    release(); await (await done).finished();
    await expect(action(page,"tab-properties")).toHaveAttribute("aria-selected","true");
    await expect(action(page,"tab-layout")).toHaveCount(0); await expect(page.getByTestId("candidate-card")).toHaveCount(0);
    expect((await snapshot(page,id)).documentHash).toBe(saved.documentHash);
  } finally { release(); }
});

test("multi-panel typography writes one undoable transaction and tab arrows do not nudge artwork", async ({ page }) => {
  await preferences(page); await page.goto("/"); const id=await sample(page); const original=await snapshot(page,id);
  await action(page,"tab-properties").focus(); await page.keyboard.press("ArrowRight");
  await expect(action(page,"tab-ai")).toBeFocused(); expect((await snapshot(page,id)).documentHash).toBe(original.documentHash);
  await page.keyboard.press("ArrowLeft"); await page.getByTestId("canvas").focus(); await page.keyboard.press("Control+A");
  const size=page.getByTestId("right-sidebar").getByLabel("字号 (pt)",{exact:true});
  await size.fill("11"); await size.press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText("已保存");
  const next=await snapshot(page,id);
  expect(next.revision).toBe(original.revision+1);
  expect(Object.values(next.document.panels).every((p:any)=>p.labelOverrides.typography.fontSizePt===11)).toBe(true);
  await action(page,"undo").click();
  await expect.poll(async()=>(await snapshot(page,id)).documentHash).toBe(original.documentHash);
});

test("leaving waits for an in-flight import and retains the newly imported panel", async ({ page }) => {
  await preferences(page); await page.goto("/"); const id=await sample(page);
  let release!:()=>void, started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const requestStarted=new Promise<void>(resolve=>{started=resolve;});
  await page.route("**/api/v1/projects/*/assets",async route=>{
    if(route.request().method()!=="POST")return route.continue();
    const response=await route.fetch();started();await gate;await route.fulfill({response});
  });
  try {
    await page.getByTestId("import-input").setInputFiles({name:"navigation-check.svg",mimeType:"image/svg+xml",buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"><rect width="40" height="30" fill="#437A7B"/></svg>')});
    await requestStarted;
    await action(page,"project-menu").click();await action(page,"return-home").click();
    await expect(page.getByTestId("home-page")).toHaveCount(0);
    release();await expect(page.getByTestId("home-page")).toBeVisible();
    expect((await snapshot(page,id)).document.panelOrder).toHaveLength(7);
    await page.locator(".brand-resume").click();await expect(page.locator(".panel-frame")).toHaveCount(7);
  } finally {release();}
});

test("project library reopens the current session and searches beyond its first fifty rows", async ({ page }) => {
  await preferences(page);await page.goto("/");const id=await sample(page);await home(page);
  await action(page,"all-projects").click();await page.getByTestId("project-search").fill("single-cell");
  await action(page,"open-listed-project").first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page).toHaveURL(new RegExp(id+"$"));
  const prefix="Library "+Date.now()+" ";
  for(let i=0;i<52;i++)expect((await page.request.post("/api/v1/projects",{headers:{"Idempotency-Key":crypto.randomUUID()},data:{title:prefix+i}})).ok()).toBe(true);
  await home(page);await action(page,"all-projects").click();await page.getByTestId("project-search").fill(prefix+"0");
  await expect(action(page,"open-listed-project")).toHaveText(prefix+"0");
  await action(page,"delete-listed-project").click();await expect(action(page,"open-listed-project")).toHaveCount(0);
  await action(page,"project-trash").click();await expect(action(page,"open-listed-project")).toHaveText(prefix+"0");
  await action(page,"restore-listed-project").click();await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox",{name:"名称",exact:true})).toHaveValue(prefix+"0");
});
