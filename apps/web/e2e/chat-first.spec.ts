import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const sample = (s: string) => path.join(root, "fixtures/scientific-svg", s);
const files = [sample("ggplot2-scatter.svg"), sample("ggplot2-scatter-natural-width.svg")];
const act = (page: Page, name: string) => page.locator('[data-action="' + name + '"]:visible');
async function dropOrAttach(page: Page, names: string[]) {
  const picker = page.waitForEvent("filechooser");
  await act(page, "empty-import").click();
  await (await picker).setFiles(names);
}
test("an offline author restores the brief without suggested answers and sends only the staged images", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("panelstudio.visual-reading", "off");
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ locale: "zh-CN", theme: "light", motion: "off" }),
    );
  });
  const created: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/v1/projects")
      created.push(req.url());
  });
  await page.goto("/");
  await page.getByTestId("start-brief").fill("我想给 Fig. 2 选图，但还没想好要讲什么");
  await page.getByTestId("start-brief").press("Enter");
  const card = page.getByTestId("question-card");
  await expect(page.getByRole("log")).toContainText("添加候选图后");
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("log")).toContainText("还没想好要讲什么");
  expect(created).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("手机图稿需求.png") });
  await page.getByTestId("start-brief").fill("比较两种处理的剂量曲线");
  await page.getByTestId("start-brief").press("Enter");
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("log")).toContainText("比较两种处理的剂量曲线");
  await dropOrAttach(page, files);
  await expect(act(page, "remove-attachment")).toHaveCount(2);
  await act(page, "remove-attachment").last().click();
  await expect(act(page, "remove-attachment")).toHaveCount(1);
  await expect(page).toHaveURL(/\/$/);
  expect(created).toHaveLength(0);
  await act(page, "start-send").click();
  await expect(page).toHaveURL(/\/app\/[a-f\d-]+$/);
  await expect(page.locator("[data-asset-choice]")).toHaveCount(1);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("panelstudio.figure-wish." + location.pathname.split("/").at(-1))!),
  );
  expect(saved.turns).toContain("比较两种处理的剂量曲线");
  expect(created).toHaveLength(1);
});
test("model choices and a free answer share one composer, retain a failed answer, and continue into visual selection", async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ locale: "zh-CN", theme: "light", motion: "off" }),
    ),
  );
  await page.route("**/api/v1/settings/ai-provider", (r) =>
    r.fulfill({
      json: {
        hasSecret: true,
        configRevision: 8,
        config: {
          adapter: "openai-compatible",
          model: "case-reader",
          baseUrl: "https://example.com",
          allowLocalEndpoint: false,
          capabilities: { imageInput: true, structuredOutput: "json_object" },
        },
      },
    }),
  );
  let step = 0;
  const prompts: string[] = [];
  await page.route("**/api/v1/figure-brief", async (r) => {
    const body = r.request().postDataJSON();
    prompts.push(body.turns.at(-1).text);
    step++;
    if (step === 2)
      return r.fulfill({
        status: 502,
        json: {
          error: { code: "MODEL_OUTPUT_INVALID", message: "fixture", details: {}, requestId: "fixture" },
        },
      });
    await r.fulfill({
      json:
        step === 1
          ? {
              kind: "question",
              intent: "select",
              reply: "要保留个体差异，还是突出组间均值？",
              options: ["保留个体差异", "突出组间均值"],
              request: "帮我选图",
            }
          : {
              kind: "ready",
              intent: "select",
              reply: "可以添加候选图了。",
              options: [],
              request: "呈现个体差异和组间均值，整张宽 85 mm",
            },
    });
  });
  await page.route("**/figure-readings", async (r) => {
    const body = r.request().postDataJSON();
    const response = await r.fetch({ postData: { ...body, vision: false, preferSaved: false } });
    return r.fulfill({ response });
  });
  const discussion: string[][] = [];
  await page.route("**/figure-discussion", (r) => {
    const body = r.request().postDataJSON();
    discussion.push(body.turns);
    const [a, b] = body.assets;
    return r.fulfill({
      json:
        discussion.length === 1
          ? {
              kind: "question",
              reply: "要让哪张图先出现？",
              options: ["个体观测在前", "均值比较在前"],
              picks: [],
              rows: [],
            }
          : {
              kind: "proposal",
              reply: "上排并列显示两张图。",
              options: [],
              picks: [
                { id: a.id, reason: "原始值" },
                { id: b.id, reason: "均值" },
              ],
              rows: [[a.id, b.id]],
            },
    });
  });
  await page.goto("/");
  await page.screenshot({ path: info.outputPath("桌面首页.png") });
  await page.getByTestId("start-brief").fill("帮我选图");
  await act(page, "start-send").click();
  const card = page.getByTestId("question-card");
  await expect(card).toContainText("保留个体差异");
  expect(prompts).toEqual(["帮我选图"]);
  await page.screenshot({ path: info.outputPath("桌面提问卡.png") });
  const input = page.getByTestId("start-brief");
  await expect(input).toHaveAccessibleDescription("要保留个体差异，还是突出组间均值？");
  await input.fill("两个都要，85 mm");
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true });
  expect(prompts).toHaveLength(1);
  await input.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("两个都要，85 mm");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText("可以添加候选图了");
  await dropOrAttach(page, files);
  await act(page, "start-send").click();
  await expect(card).toContainText("要让哪张图先出现");
  await card.getByRole("button", { name: "个体观测在前" }).click();
  await expect(page.locator("[data-asset-choice][aria-pressed=true]")).toHaveCount(2);
  expect(discussion[0]).toContain("两个都要，85 mm");
  expect(discussion[1]?.at(-1)).toBe("个体观测在前");
  await page.getByTestId("wish-input").fill("两张并排，整张宽 85 mm");
  await act(page, "wish-draft").click();
  await expect(page.locator(".panel-frame")).toHaveCount(2);
  const d = await (
    await page.request.get("/api/v1/projects/" + new URL(page.url()).pathname.split("/").at(-1) + "/document")
  ).json();
  expect(d.document.canvas.widthMm).toBe(85);
});

test("drag and paste only stage attachments and a refresh explains which files need reattaching", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    localStorage.setItem("panelstudio.visual-reading", "off");
    localStorage.setItem(
      "panelstudio.prefs",
      JSON.stringify({ locale: "zh-CN", theme: "dark", motion: "off" }),
    );
  });
  await page.goto("/");
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(
      new File(['<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>'], "pasted.svg", {
        type: "image/svg+xml",
      }),
    );
    document
      .querySelector('[data-testid="start-brief"]')
      ?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    const drop = new DataTransfer();
    drop.items.add(
      new File(['<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>'], "dropped.svg", {
        type: "image/svg+xml",
      }),
    );
    document
      .querySelector('[data-testid="home-page"]')
      ?.dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
  });
  await expect(act(page, "remove-attachment")).toHaveCount(2);
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.getByRole("status")).toContainText("重新添加之前的 2 张图片");
  await dropOrAttach(page, [files[0]!]);
  await expect(act(page, "remove-attachment")).toHaveCount(1);
  await expect(page.getByText("重新添加之前的", { exact: false })).toHaveCount(0);
  await act(page, "remove-attachment").first().click();
  await page.getByTestId("start-brief").fill("不知道怎么选图");
  await act(page, "start-send").click();
  const card = page.getByTestId("question-card");
  await expect(page.getByRole("log")).toContainText("添加候选图后");
  await expect(card).toHaveCount(0);
  await expect(act(page, "home-menu")).toBeInViewport();
  await expect(page.getByTestId("start-brief")).toBeInViewport();
  await act(page, "home-menu").click();
  await act(page, "menu-new-opening").click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("start-brief")).toHaveValue("");
});
