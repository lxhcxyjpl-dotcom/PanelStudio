# Six-panel refinement example · 六图连续精修

Open `start.figurezip` from the project menu. It contains five original vector drawings and one raster heatmap after initial automatic layout. The source drawings and their MIT license are under [synthetic-six](../synthetic-six/).

1. Open **AI 布局**, choose **全图**, and send **把六张图排成两行三列**.
2. Keep the draft open and send **在这个草案上，把 A 的编号向右移动 1 mm。**
3. Switch **原稿** and **草案**. Apply the complete draft. One undo takes you back to the starting layout.
4. Select label B on the canvas and drag it slightly to the right. Select panels B and C with Shift. In the inspector choose a local row with **等宽** and apply the candidate.
5. Export **可编辑 SVG**. The captured result is `refined.svg`. `refined.ai` is the native Illustrator copy of that six-panel export, saved and reopened on Windows.

The recording uses a local deterministic provider for those requests. To reproduce the recorded interaction with no model credentials, run `pnpm test:e2e --grep "v0.2 six-panel"`. With a configured model, the same text is sent through the project’s regular provider and its proposed actions may differ. The screenshots and video are referenced in the [test record](../../docs/test-record.md).
