# Demo script

Handbook demonstration:

> 导入六张图 → 一键排版 → 一句话调整主图 → 导出 SVG → Illustrator 中修改编号和曲线。

Import six images, auto-layout, adjust the primary with one sentence, export SVG, then edit a label and a curve in Illustrator.

## What a person records

Illustrator is not in the files below. A human needs to record the last step: open the SVG, change a label with the Type tool, and edit a curve. Use Noto Sans and Noto Sans SC installed, and the 0.1 mm / 0.1 pt checks in `docs/illustrator-compatibility.md`.

## In-app capture

`docs/screenshots/` and `docs/demo/in-app-walkthrough.webm` come from Playwright driving the real app (`apps/web/e2e/walkthrough.spec.ts`) on 10 November 2026.

The webm holds on each state: empty editor, six imported drawings, layout candidates, the applied layout, the AI proposal, and the export dialog. It does not show the pointer, and it does not include Illustrator.

The sentence in that capture is `把 C 放左边作为主图`. The model is the local corpus stand-in from the phase 5 tests, not a hosted model. The app still parses that response, compiles it with the real intent compiler, previews it, and applies it through the normal transaction path. A recording with a person’s own provider is optional. The product works without any provider.

Regenerate the stills and the webm with:

```bash
PANELSTUDIO_SHOTS=1 PANELSTUDIO_VIDEO=1 pnpm exec playwright test -c apps/web/playwright.config.ts apps/web/e2e/walkthrough.spec.ts
```

Copy the new `video.webm` from `apps/web/test-results/` to `docs/demo/in-app-walkthrough.webm` if you want to replace the committed file.

## Spoken script

1. Start from an empty figure. Import the six drawings in `examples/synthetic-six/assets/` (`line.svg`, `bars.svg`, `scatter.svg`, `schematic.svg`, `histogram.svg`, and `heatmap.svg` or `heatmap.png`).
2. Choose **一键排版**. Look at the candidates. Apply one.
3. Open **AI 布局**. The status line says AI is optional when no provider is saved. With a provider configured, type `把 C 放左边作为主图` and send it. Apply the preview. The saved figure does not change until then.
4. Export **可编辑 SVG**. The dialog names Noto Sans and Noto Sans SC and offers the font zip. The file keeps `<text>` and the curve paths.
5. In Illustrator, File → Open that SVG. Change label A to X with the Type tool. Select the curve in panel A (`series` in `line.svg`) and edit a point. Save if you want a `.ai`.

## 演示脚本

1. 从空图稿导入 `examples/synthetic-six/assets/` 里的六张图。
2. 点 **一键排版**，看候选，使用其中一个。
3. 在 **AI 布局** 输入 `把 C 放左边作为主图` 并发送。未配置模型时，这句话只会留在输入框里，导入、排版和导出不受影响。应用预览之后，图稿才改变。
4. 导出可编辑 SVG。文字仍是文字，曲线仍是路径。
5. 在 Illustrator 中用文件 → 打开。用文字工具把 A 改成 X，并改一条导入的曲线。这一步需要人来录。仓库里的 webm 没有 Illustrator。
