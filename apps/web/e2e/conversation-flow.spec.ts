import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const figure = fileURLToPath(new URL("../../../fixtures/scientific-svg/ggplot2-scatter.svg", import.meta.url));
const action = (p: Page, name: string) => p.locator('[data-action="' + name + '"]:visible');
const provider = { hasSecret: true, configRevision: 1, config: { baseUrl: "https://api.deepseek.com", model: "test", capabilities: { imageInput: true } } };
const question = { kind: "question", intent: "select", reply: "Fig. 2 更想展示什么？", options: ["组间差异", "个体变化"], request: "选择两张图" };
function gate() {
  let open!: () => void;
  const ready = new Promise<void>(resolve => { open = resolve; });
  return { ready, open };
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("panelstudio.prefs", JSON.stringify({ locale: "zh-CN", theme: "light", motion: "off" })));
  await page.route("**/api/v1/settings/ai-provider", r => r.fulfill({ json: provider }));
});

test("keeps one mobile composer, cursor, multiline draft and staged artwork through an incoming question", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const release = gate();
  const sent: string[] = [];
  await page.route("**/api/v1/figure-brief", async r => {
    sent.push(r.request().postDataJSON().turns.at(-1).text);
    if (sent.length === 1) await release.ready;
    await r.fulfill({ json: sent.length === 1 ? question : { ...question, kind: "ready", options: [], reply: "请添加这两张图。" } });
  });
  let projects = 0;
  page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/projects") projects++; });
  await page.goto("/");
  const input = page.getByTestId("start-brief"), form = page.locator(".chat-composer");
  await input.fill("先帮我选图"); await input.press("Enter");
  await expect(action(page, "stop-opening")).toBeVisible();
  await expect(input).toBeEditable();
  const node = await input.elementHandle();
  await page.locator(".opening-chat input[type=file]").setInputFiles(figure);
  const before = await input.boundingBox();
  const draft = "补充一条\n两张都用\n先看个体\n再看组间\n图宽 85 mm";
  await input.fill(draft);
  await input.evaluate(el => (el as HTMLTextAreaElement).setSelectionRange(3, 3));
  const dock = await form.boundingBox();
  expect((await input.boundingBox())!.height).toBeGreaterThan(before!.height + 12);
  release.open(); await expect(page.getByTestId("question-card")).toBeVisible();
  await expect(input).toHaveAccessibleDescription(question.reply);
  await expect(input).toHaveValue(draft); await expect(input).toBeFocused();
  expect(await node!.evaluate(el => el.isConnected && (el as HTMLTextAreaElement).selectionStart === 3)).toBe(true);
  const after = await form.boundingBox();
  expect(Math.abs(after!.y + after!.height - dock!.y - dock!.height)).toBeLessThan(3);
  await action(page, "question-option").first().click();
  await expect(page.getByRole("log")).toContainText("请添加这两张图。");
  await expect(input).toHaveValue(draft);
  await expect(action(page, "remove-attachment")).toHaveCount(1);
  expect(sent).toEqual(["先帮我选图", "组间差异"]); expect(projects).toBe(0);
});

test("stops a reply and retries it separately from the next draft and its images", async ({ page }) => {
  const release = gate(), arrived = gate();
  const sent: string[][] = [];
  await page.route("**/api/v1/figure-brief", async r => {
    sent.push(r.request().postDataJSON().turns.map((v: {text: string}) => v.text));
    if (sent.length === 1) { arrived.open(); await release.ready; await r.fulfill({ json: { ...question, reply: "过期回复" } }).catch(() => {}); }
    else if (sent.length === 2) await r.fulfill({ status: 502, json: { error: { code: "MODEL_OUTPUT_INVALID", message: "retry", details: {} } } });
    else await r.fulfill({ json: question });
  });
  await page.goto("/");
  const input = page.getByTestId("start-brief");
  await input.fill("帮我选图"); await input.press("Enter"); await arrived.ready;
  await input.fill("下一句要用的草稿"); await page.locator(".opening-chat input[type=file]").setInputFiles(figure);
  await action(page, "stop-opening").click();
  await expect(page.getByRole("log")).toContainText("回复已停止"); release.open();
  await expect(input).toHaveValue("下一句要用的草稿");
  await action(page, "retry-opening").click(); await expect(page.getByRole("alert")).toBeVisible();
  await action(page, "retry-opening").click(); await expect(page.getByTestId("question-card")).toBeVisible();
  await expect(input).toHaveValue("下一句要用的草稿"); await expect(action(page, "remove-attachment")).toHaveCount(1);
  expect(sent).toEqual([["帮我选图"], ["帮我选图"], ["帮我选图"]]);
  await expect(page.getByRole("log")).not.toContainText("过期回复");
  expect(await page.getByRole("log").locator(".opening-turn.user").count()).toBe(1);
});

test("can stop a selection discussion without applying late model picks or losing the next edit", async ({page}) => {
  const release = gate(), arrived = gate(); let calls = 0;
  await page.route("**/figure-readings", async r => {
    const local = await r.fetch({postData:{...r.request().postDataJSON(),vision:false,preferSaved:false}});
    await r.fulfill({response:local});
  });
  await page.route("**/figure-discussion", async r => {
    const ids = r.request().postDataJSON().assets.map((a:{id:string})=>a.id);
    if (++calls === 1) { arrived.open(); await release.ready; }
    await r.fulfill({json:{kind:"proposal",reply:"这两张并排。",options:[],picks:ids.map((id:string)=>({id,reason:"用于比较"})),rows:[ids]}}).catch(()=>{});
  });
  await page.goto("/");
  const input = page.getByTestId("start-brief");
  const second = fileURLToPath(new URL("../../../fixtures/scientific-svg/ggplot2-scatter-natural-width.svg", import.meta.url));
  await page.locator(".opening-chat input[type=file]").setInputFiles([figure,second]);
  await input.fill("帮我选图，比较两组的趋势"); await input.press("Enter"); await arrived.ready;
  const work = page.getByTestId("wish-workbench"), next = page.getByTestId("wish-input");
  await expect(action(page,"stop-discussion")).toBeVisible();
  await next.fill("把两种结果放在一起比较");
  await next.press("Escape"); release.open();
  await expect(work).toContainText("回复已停止");
  await expect(next).toHaveValue("把两种结果放在一起比较");
  await expect(page.locator('[data-asset-choice][aria-pressed="true"]')).toHaveCount(0);
  await next.press("Enter");
  await expect(page.locator('[data-asset-choice][aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator(".wish-tile-reason").first()).toHaveText("用于比较");
  await expect(action(page,"wish-draft")).toHaveText("用这 2 张排版");
  await expect(page.locator(".wish-feed").locator('[data-action="wish-draft"]')).toHaveCount(0);
  expect(calls).toBe(2);
});

test("keeps a follow-up being typed while a replacement image uploads", async ({page}) => {
  await page.addInitScript(() => localStorage.setItem("panelstudio.visual-reading","off"));
  await page.goto("/");
  const second = fileURLToPath(new URL("../../../fixtures/scientific-svg/ggplot2-scatter-natural-width.svg", import.meta.url));
  await page.locator(".opening-chat input[type=file]").setInputFiles([figure, second]);
  await page.getByTestId("start-brief").fill("A 和 B 并排"); await action(page,"start-send").click();
  const work = page.getByTestId("wish-workbench"), input = page.getByTestId("wish-input");
  await expect(work).toContainText("第一稿已排好");
  const release = gate(), arrived = gate();
  await page.route("**/api/v1/projects/*/assets", async route => {
    if (route.request().method() === "POST") { arrived.open(); await release.ready; }
    await route.continue();
  });
  const picker = page.waitForEvent("filechooser");
  await input.fill("把 B 换成新版"); await action(page,"wish-send").click();
  await (await picker).setFiles(fileURLToPath(new URL("../../../examples/showcase/assets/experimental-bars.svg", import.meta.url)));
  await arrived.ready; await input.fill("下一步想调整图注"); release.open();
  await expect(work).toHaveAttribute("aria-busy", "false");
  await expect(input).toHaveValue("下一步想调整图注");
});

test("preserves the reading position and exposes older messages beyond the model context window", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await page.addInitScript(() => {
    const turns = Array.from({ length: 20 }, (_, i) => ({ role: i%2 ? "assistant" : "user", text: "第" + (i+1) + "条消息；讨论不同面板展示什么。" }));
    sessionStorage.setItem("panelstudio.opening.v1", JSON.stringify({ turns, request: "选图", draft: "", intent: "select" }));
  });
  const hold = gate(); let length = 0;
  await page.route("**/api/v1/figure-brief", async r => { length = r.request().postDataJSON().turns.length; await hold.ready; await r.fulfill({ json: question }); });
  await page.goto("/");
  const input = page.getByTestId("start-brief"), log = page.getByRole("log");
  await input.fill("继续"); await input.press("Enter");
  await expect(action(page, "stop-opening")).toBeVisible();
  await log.evaluate(el=>{el.scrollTop = 0;});
  await expect(action(page, "chat-latest")).toBeVisible();
  hold.open(); await expect(page.getByTestId("question-card")).toBeAttached();
  expect(await log.evaluate(el=>el.scrollTop)).toBeLessThan(5);
  await expect(log).toContainText("第1条消息");
  await action(page, "chat-latest").click();
  await expect(page.getByTestId("question-card")).toBeInViewport();
  await expect(action(page, "chat-latest")).toHaveCount(0);
  expect(length).toBe(12);
});
