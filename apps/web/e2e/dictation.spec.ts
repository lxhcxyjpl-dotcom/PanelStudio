import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const sample = fileURLToPath(new URL("../../../fixtures/scientific-svg/ggplot2-scatter.svg", import.meta.url));
const action = (page: Page, name: string) => page.locator('[data-action="' + name + '"]:visible');
const official = { hasSecret: true, configRevision: 1, config: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash", capabilities: { imageInput: true } } };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/settings/ai-provider", route => route.fulfill({ json: official }));
  await page.addInitScript(() => {
    localStorage.setItem("panelstudio.prefs", JSON.stringify({ locale: "zh-CN", theme: "light", motion: "off" }));
    localStorage.setItem("panelstudio.visual-reading", "off");
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext(), tone = context.createOscillator(), dest = context.createMediaStreamDestination();
      tone.connect(dest); tone.start(); await context.resume();
      const track = dest.stream.getAudioTracks()[0]!;
      const previousStop = track.stop.bind(track);
      track.stop = () => { previousStop(); tone.stop(); void context.close(); document.body.dataset.testMic = "off"; };
      Object.defineProperty(document.body, "testMicSeconds", { configurable: true, get: () => context.currentTime });
      document.body.dataset.testMic = "on";
      return dest.stream;
    } });
  });
});
async function speak(page: Page) {
  const mic = action(page, "dictate");
  await mic.click();
  await expect(mic).toHaveAttribute("data-phase", "recording");
  // Wait for the real audio clock, which can lag wall time on a loaded runner.
  await page.waitForFunction(() => (document.body as HTMLElement & { testMicSeconds: number }).testMicSeconds >= 1.2);
  await mic.click();
}
async function modelLayoutQuestion(page: Page) {
  await page.route("**/api/v1/figure-brief", route => {
    const authorTurns = route.request().postDataJSON().turns.filter((turn: {role:string}) => turn.role === "user");
    return route.fulfill({json: authorTurns.length > 1
      ? {kind:"ready",intent:"arrange",reply:"可以添加图了",options:[],request:"剂量曲线在前"}
      : {kind:"question",intent:"arrange",reply:"你希望剂量曲线还是原始观测在前？",
          options:["剂量曲线在前","原始观测在前"],request:"安排剂量和原始观测"}});
  });
  await page.locator(".model-chip").click();
}

test("voice stays editable with attachments and retries the original clip while preserving typed changes", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  const bodies: Buffer[] = [], sends: string[] = [];
  page.on("request", r => { if (r.method() === "POST" && /\/(figure-brief|projects)$/.test(r.url())) sends.push(r.url()); });
  await page.route("**/api/v1/speech/transcriptions", async route => {
    bodies.push(route.request().postDataBuffer()!);
    if (bodies.length === 1) return route.fulfill({ status: 503, json: { error: { code: "SPEECH_UNAVAILABLE", message: "busy", details: {} } } });
    await route.fulfill({ json: { text: "图宽 85 毫米。" } });
  });
  await page.goto("/");
  const input = page.getByTestId("start-brief");
  await input.fill("Fig. 2。");
  await page.locator(".opening-chat input[type=file]").setInputFiles(sample);
  await speak(page);
  await expect(page.getByTestId("voice-feedback")).toContainText("服务正忙");
  await expect(page.locator("body")).toHaveAttribute("data-test-mic", "off");
  await input.fill("刚补的一句。");
  await page.getByRole("button", { name: "重试转写" }).click();
  await expect(input).toHaveValue("刚补的一句。图宽 85 毫米。");
  await expect(input).toBeFocused();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]!.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bodies[0]!.readUInt32LE(24)).toBe(16000);
  expect(bodies[0]!.length).toBeGreaterThan(1000);
  expect(sends).toEqual([]);
  await expect(action(page, "remove-attachment")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("dictates a custom card answer and a refinement, releases a cancelled mic and keeps the figure revision", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/v1/speech/transcriptions", r => { requests++; return r.fulfill({ json: { text: "上下排" } }); });
  await page.goto("/");
  await modelLayoutQuestion(page);
  await page.getByTestId("start-brief").fill("我不知道这张图该怎么排");
  await action(page, "start-send").click();
  const card = page.getByTestId("question-card");
  await expect(card).toBeVisible();
  await speak(page);
  await expect(page.getByTestId("start-brief")).toHaveValue("上下排");
  await page.locator(".model-chip").click();
  await page.locator(".opening-chat input[type=file]").setInputFiles(sample);
  await action(page, "start-send").click();
  await expect(page).toHaveURL(/\/app\/[a-f\d-]+$/);
  const wish = page.getByTestId("wish-input");
  await expect(wish).toBeVisible();
  const url = "/api/v1/projects/" + new URL(page.url()).pathname.split("/").at(-1) + "/document";
  const doc = async () => (await page.request.get(url)).json();
  await expect.poll(async () => (await doc()).document.panelOrder.length).toBe(1);
  await expect(action(page, "dictate")).toBeEnabled();
  const before = (await doc()).revision;
  await wish.fill("改成左右排。");
  await wish.evaluate(el => (el as HTMLTextAreaElement).setSelectionRange(2, 5));
  await action(page, "dictate").click();
  await expect(action(page, "dictate")).toHaveAttribute("data-phase", "recording");
  await action(page, "cancel-dictation").click();
  await expect(page.locator("body")).toHaveAttribute("data-test-mic", "off");
  await expect(wish).toHaveValue("改成左右排。");
  expect(requests).toBe(1);
  await wish.evaluate(el => (el as HTMLTextAreaElement).setSelectionRange(2, 5));
  await speak(page);
  await expect(wish).toHaveValue("改成上下排。");
  expect((await doc()).revision).toBe(before);
  expect(requests).toBe(2);
  await action(page, "tab-ai").click();
  const expert = page.getByTestId("ai-prompt");
  await expect(expert).toBeVisible();
  await speak(page);
  await expect(expert).toHaveValue("上下排");
  expect((await doc()).revision).toBe(before);
});

test("choosing a card option cancels a pending transcript before the next draft", async ({ page }) => {
  let arrived!: () => void, release!: () => void;
  const requested = new Promise<void>(resolve => { arrived = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/speech/transcriptions", async route => {
    arrived(); await waiting;
    await route.fulfill({ json: { text: "过期的转写" } }).catch(() => {});
  });
  await page.goto("/");
  await modelLayoutQuestion(page);
  await page.getByTestId("start-brief").fill("不知道怎么排");
  await action(page, "start-send").click();
  const card = page.getByTestId("question-card");
  await expect(card).toBeVisible();
  await speak(page);
  await requested;
  await card.getByRole("button", { name: "剂量曲线在前" }).click();
  release();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("start-brief")).toHaveValue("");
  await expect(page.getByRole("log")).toContainText("剂量曲线在前");
  await expect(page.getByTestId("voice-feedback")).toHaveCount(0);
});

test("denied permission leaves an existing draft intact and makes no speech request", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => { throw new DOMException("denied", "NotAllowedError"); } }));
  let uploads = 0;
  await page.route("**/api/v1/speech/transcriptions", r => { uploads++; return r.abort(); });
  await page.goto("/");
  const input = page.getByTestId("start-brief");
  await input.fill("保留我的草稿");
  await action(page, "dictate").click();
  await expect(page.getByTestId("voice-feedback")).toContainText("允许使用麦克风");
  await expect(input).toHaveValue("保留我的草稿");
  expect(uploads).toBe(0);
  await expect(action(page, "start-send")).toBeEnabled();
});
