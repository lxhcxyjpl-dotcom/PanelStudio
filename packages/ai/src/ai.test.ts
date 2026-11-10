import { createServer } from "node:http";
import { createDefaultFigureDocument, DEFAULT_RELATIVE_ENLARGE, type FigureDocumentV1 } from "@panelstudio/contracts";
import type { AssetLookup } from "@panelstudio/core";
import { describe, expect, it } from "vitest";
import { postChatCompletion } from "./adapter.js";
import { compileProposal } from "./compile.js";
import { CORPUS_PROMPTS, fixtureIntent } from "./corpus-fixture.js";
import { isDirectUndo } from "./direct.js";
import { chatCompletionsUrl, endpointProblem } from "./endpoint.js";
import { AiCompileError } from "./errors.js";
import { resolveModelIntent } from "./resolve.js";
import { buildScene } from "./scene.js";

const IDS = [
  "11111111-1111-4111-8111-111111111101",
  "11111111-1111-4111-8111-111111111102",
  "11111111-1111-4111-8111-111111111103",
  "11111111-1111-4111-8111-111111111104",
  "11111111-1111-4111-8111-111111111105",
  "11111111-1111-4111-8111-111111111106",
] as const;
const SQUARE = "22222222-2222-4222-8222-222222222221";
const WIDE = "22222222-2222-4222-8222-222222222222";

function figure(): { document: FigureDocumentV1; assets: AssetLookup } {
  const document = createDefaultFigureDocument();
  const frames = [
    { x: 8, y: 20, width: 36, height: 36 },
    { x: 52, y: 20, width: 36, height: 36 },
    { x: 96, y: 28, width: 36, height: 18 },
    { x: 8, y: 70, width: 36, height: 36 },
    { x: 52, y: 70, width: 36, height: 36 },
    { x: 96, y: 70, width: 36, height: 36 },
  ];
  IDS.forEach((id, index) => {
    const frame = frames[index];
    if (!frame) return;
    document.panels[id] = {
      assetId: index === 2 ? WIDE : SQUARE,
      name: `Panel ${index + 1}`,
      frameMm: frame,
      cropNormalized: { x: 0, y: 0, width: 1, height: 1 },
      locked: false,
      labelOverrides: { visible: null, text: null, placement: null, offsetMm: null, typography: null },
    };
  });
  document.panelOrder = [...IDS];
  document.stackOrder = [...IDS];
  document.layoutSettings.maxAutoHeightMm = 800;
  const assets: AssetLookup = (assetId) => {
    if (assetId === SQUARE) return { id: assetId, originalFilename: "square.png", viewport: { width: 100, height: 100 }, rasterPixelSize: { width: 100, height: 100 } };
    if (assetId === WIDE) return { id: assetId, originalFilename: "wide.png", viewport: { width: 100, height: 50 }, rasterPixelSize: { width: 100, height: 50 } };
    return null;
  };
  return { document, assets };
}

function sceneFor(document: FigureDocumentV1, selected: string[] = []) {
  return buildScene(document, { baseRevision: 3, configRevision: 2, selectedPanelIds: selected });
}

describe("provider endpoint", () => {
  it("appends /chat/completions exactly once", () => {
    expect(chatCompletionsUrl("http://127.0.0.1:9/v1")).toBe("http://127.0.0.1:9/v1/chat/completions");
    expect(chatCompletionsUrl("http://127.0.0.1:9/v1/")).toBe("http://127.0.0.1:9/v1/chat/completions");
    expect(chatCompletionsUrl("http://127.0.0.1:9/v1/chat/completions")).toBe("http://127.0.0.1:9/v1/chat/completions");
    expect(chatCompletionsUrl("http://127.0.0.1:9/v1/chat/completions?token=secret#x")).toBe(
      "http://127.0.0.1:9/v1/chat/completions",
    );
  });

  it("requires https for remote hosts and an explicit flag for local hosts", () => {
    expect(endpointProblem("https://example.test/v1", false)).toBeNull();
    expect(endpointProblem("http://example.test/v1", true)).toMatch(/HTTPS/);
    expect(endpointProblem("http://127.0.0.1:9/v1", false)).toMatch(/allowLocalEndpoint/);
    expect(endpointProblem("http://127.0.0.1:9/v1", true)).toBeNull();
    expect(endpointProblem("http://user:secret@127.0.0.1:9/v1", true)).toMatch(/credentials/);
  });
});

describe("handbook corpus", () => {
  it("recognizes undo without treating it as a model action", () => {
    expect(isDirectUndo(" 撤销 ")).toBe(true);
    expect(isDirectUndo("Undo")).toBe(true);
    expect(isDirectUndo("请撤销刚才的移动")).toBe(false);
    expect(CORPUS_PROMPTS).toHaveLength(24);
  });

  it("compiles every recorded prompt to the same commands twice", () => {
    const { document, assets } = figure();
    const selected = document.panelOrder.slice(0, 3);
    for (const prompt of CORPUS_PROMPTS) {
      if (prompt === "撤销") continue;
      const source = prompt === "整张图宽度设为 180 mm，再重新排一下" ? narrower(document) : document;
      const scene = sceneFor(source, selected);
      const intent = fixtureIntent(prompt, scene);
      expect(intent, prompt).not.toBeNull();
      if (!intent || intent.kind !== "proposal") continue;
      let first: ReturnType<typeof compileProposal>;
      try {
        first = compileProposal(source, intent, assets);
      } catch (error) {
        throw new Error(prompt, { cause: error });
      }
      const second = compileProposal(source, intent, assets);
      expect(second.commands, prompt).toEqual(first.commands);
      expect(second.previewDocument, prompt).toEqual(first.previewDocument);
      expect(first.summary.length, prompt).toBeGreaterThan(0);
    }
  });

  it("matches the corpus geometry and label edits", () => {
    const { document, assets } = figure();
    const selected = document.panelOrder.slice(0, 3);
    const compile = (prompt: string, source = document) => {
      const intent = fixtureIntent(prompt, sceneFor(source, selected));
      if (!intent || intent.kind !== "proposal") throw new Error(prompt);
      return compileProposal(source, intent, assets);
    };
    const rows = compile("把六张图排成两行三列");
    expect(rows.validationMode).toBe("layout");
    const top = rows.previewDocument.panels[IDS[0]]?.frameMm.y;
    const bottom = rows.previewDocument.panels[IDS[3]]?.frameMm.y;
    expect(top).toBeDefined();
    expect(bottom).toBeGreaterThan(top ?? 0);
    expect(rows.previewDocument.panels[IDS[1]]?.frameMm.y).toBeCloseTo(top ?? 0, 3);
    expect(rows.previewDocument.panels[IDS[5]]?.frameMm.y).toBeCloseTo(bottom ?? 0, 3);

    const hero = compile("把 C 放左边作为主图");
    const heroX = hero.previewDocument.panels[IDS[2]]?.frameMm.x ?? 0;
    expect(heroX).toBeLessThan(hero.previewDocument.panels[IDS[0]]?.frameMm.x ?? 0);
    expect(heroX).toBeLessThan(hero.previewDocument.panels[IDS[1]]?.frameMm.x ?? 0);

    const gutter = compile("横向间距 2 mm，纵向间距 4 mm");
    expect(gutter.previewDocument.layoutSettings.gutterMm).toEqual({ horizontal: 2, vertical: 4 });
    expect(gutter.validationMode).toBe("layout");

    const moved = compile("把 A 向右移动 2 mm");
    expect(moved.validationMode).toBe("edit");
    expect(moved.previewDocument.panels[IDS[0]]?.frameMm.x).toBe((document.panels[IDS[0]]?.frameMm.x ?? 0) + 2);
    expect(moved.previewDocument.panels[IDS[1]]).toEqual(document.panels[IDS[1]]);
    expect(moved.commands).toEqual([expect.objectContaining({ type: "panel.setFrames" })]);

    const scaled = compile("B 的宽度设为 50 mm");
    expect(scaled.previewDocument.panels[IDS[1]]?.frameMm).toMatchObject({ x: 52, y: 20, width: 50, height: 50 });
    expect(scaled.previewDocument.panels[IDS[0]]?.frameMm).toEqual(document.panels[IDS[0]]?.frameMm);

    const larger = compile("A 稍微大一点");
    const before = document.panels[IDS[0]]?.frameMm;
    const after = larger.previewDocument.panels[IDS[0]]?.frameMm;
    expect(after && before ? after.width / before.width : 0).toBeCloseTo(1 + DEFAULT_RELATIVE_ENLARGE, 6);
    expect(after && before ? after.height / before.height : 0).toBeCloseTo(1 + DEFAULT_RELATIVE_ENLARGE, 6);
    expect(larger.summary).toContain("→");
    expect(after?.x).toBe(before?.x);

    const aligned = compile("B 和 C 顶部对齐");
    expect(aligned.previewDocument.panels[IDS[1]]?.frameMm.y).toBe(document.panels[IDS[1]]?.frameMm.y);
    expect(aligned.previewDocument.panels[IDS[2]]?.frameMm.y).toBe(document.panels[IDS[1]]?.frameMm.y);

    const height = compile("Make B and C the same height");
    expect(height.previewDocument.panels[IDS[2]]?.frameMm.height).toBe(document.panels[IDS[1]]?.frameMm.height);
    expect(height.previewDocument.panels[IDS[1]]?.frameMm).toEqual(document.panels[IDS[1]]?.frameMm);
    expect(height.previewDocument.panels[IDS[2]]?.frameMm).toMatchObject({ x: 96, y: 28 });

    const spread = compile("将选中的三张图水平等距分布");
    const frames = selected.map((id) => spread.previewDocument.panels[id]?.frameMm);
    const gap = (frames[1]?.x ?? 0) - ((frames[0]?.x ?? 0) + (frames[0]?.width ?? 0));
    const gap2 = (frames[2]?.x ?? 0) - ((frames[1]?.x ?? 0) + (frames[1]?.width ?? 0));
    expect(gap).toBeCloseTo(gap2, 4);
    expect(frames[0]?.x).toBe(document.panels[IDS[0]]?.frameMm.x);

    expect(compile("A 保持不动").previewDocument.panels[IDS[0]]?.locked).toBe(true);
    expect(compile("解锁 B").previewDocument.panels[IDS[1]]?.locked).toBe(false);
    expect(compile("编号改成小写 a、b、c").previewDocument.labelStyle.sequence).toBe("lower-alpha");
    expect(compile("编号加括号").previewDocument.labelStyle.format).toBe("parentheses");
    expect(compile("编号统一 9 pt，加粗").previewDocument.labelStyle).toMatchObject({ fontSizePt: 9, fontWeight: 700 });
    expect(compile("把 C 的编号改成 C1").previewDocument.panels[IDS[2]]?.labelOverrides.text).toBe("C1");
    expect(compile("编号放在左上角外侧").previewDocument.labelStyle.placement).toBe("outside-top-left");
    expect(compile("A 的编号向左移动 1 mm").previewDocument.panels[IDS[0]]?.labelOverrides.offsetMm).toEqual({
      x: -1,
      y: -document.labelStyle.gapMm,
    });
    expect(compile("Labels should be black").previewDocument.labelStyle.color).toBe("#000000");
    const paper = compile("换成白底黑字");
    expect(paper.previewDocument.canvas.background).toBe("#FFFFFF");
    expect(paper.previewDocument.labelStyle.color).toBe("#000000");
    const wide = compile("整张图宽度设为 180 mm，再重新排一下", narrower(document));
    expect(wide.validationMode).toBe("layout");
    expect(wide.previewDocument.canvas.widthMm).toBe(180);
    expect(wide.commands.some((command) => command.type === "canvas.set")).toBe(true);
  });

  it("keeps a grouped move together and rejects scaling one member", () => {
    const { document, assets } = figure();
    const groupId = "33333333-3333-4333-8333-333333333333";
    document.groups[groupId] = { name: "实验组", panelIds: [IDS[0], IDS[1]], locked: false };
    const moved = compileProposal(
      document,
      {
        version: 1,
        kind: "proposal",
        summary: "移动实验组。",
        actions: [{ type: "move_by_mm", targets: [{ kind: "group", id: groupId }], dxMm: 3, dyMm: 0 }],
      },
      assets,
    );
    expect(moved.previewDocument.panels[IDS[0]]?.frameMm.x).toBe(11);
    expect(moved.previewDocument.panels[IDS[1]]?.frameMm.x).toBe(55);
    expect(moved.previewDocument.panels[IDS[0]]?.frameMm.width).toBe(36);
    expect(() =>
      compileProposal(
        document,
        {
          version: 1,
          kind: "proposal",
          summary: "放大组内的 A。",
          actions: [{ type: "scale_to_width", panelId: IDS[0], widthMm: 40 }],
        },
        assets,
      ),
    ).toThrow(/group|Group|编辑组|partial/i);
  });

  it("rejects an unknown panel without a partial command list", () => {
    const { document, assets } = figure();
    expect(() =>
      compileProposal(
        document,
        {
          version: 1,
          kind: "proposal",
          summary: "移动不存在的面板。",
          actions: [
            {
              type: "move_by_mm",
              targets: [{ kind: "panel", id: "99999999-9999-4999-8999-999999999999" }],
              dxMm: 1,
              dyMm: 0,
            },
          ],
        },
        assets,
      ),
    ).toThrow(AiCompileError);
  });
});

describe("model output", () => {
  it("repairs one invalid response and scrubs the secret from returned text", async () => {
    let calls = 0;
    const secret = "ephemeral-test-secret";
    const fetchImpl: typeof fetch = async (_url, init) => {
      calls += 1;
      const header = new Headers(init?.headers).get("authorization");
      expect(header).toBe(`Bearer ${secret}`);
      const content = calls === 1 ? "not json" : JSON.stringify({ version: 1, kind: "unsupported", reason: `kept ${secret}` });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    };
    const { document } = figure();
    const resolved = await resolveModelIntent({
      config: {
        adapter: "openai-compatible",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "fixture-model",
        capabilities: { imageInput: false, structuredOutput: "json_object" },
        allowLocalEndpoint: true,
      },
      secret,
      prompt: "编号加括号",
      scene: sceneFor(document),
      replyLocale: "zh-CN",
      fetchImpl,
    });
    expect(calls).toBe(2);
    expect(resolved.ok).toBe(true);
    if (resolved.ok && resolved.intent.kind === "unsupported") expect(resolved.intent.reason).not.toContain(secret);
  });

  it("does not follow a redirect", async () => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls += 1;
      response.statusCode = 302;
      response.setHeader("location", "http://127.0.0.1/elsewhere");
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    await expect(
      postChatCompletion({
        config: {
          adapter: "openai-compatible",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: "fixture-model",
          capabilities: { imageInput: false, structuredOutput: "text_json" },
          allowLocalEndpoint: true,
        },
        secret: "ephemeral-test-secret",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow(/redirect/i);
    expect(calls).toBe(1);
    server.close();
  });
});

function narrower(document: FigureDocumentV1): FigureDocumentV1 {
  return { ...document, canvas: { ...document.canvas, widthMm: 140 } };
}
