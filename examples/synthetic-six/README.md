# Synthetic six

An original example project: six drawings made for PanelStudio, not taken from a paper or a stock library. License: `LICENSE.md` (MIT, same as the repository).

| File | What it is |
| --- | --- |
| `assets/line.svg` | Axes and one cubic curve, plus the text `n=24` in Noto Sans |
| `assets/bars.svg` | Five bars and one linear gradient |
| `assets/scatter.svg` | Six circles |
| `assets/schematic.svg` | Three circles and two curves |
| `assets/histogram.svg` | Ten bars |
| `assets/heatmap.svg` | A 3×4 grid of rectangles |
| `assets/heatmap.png` | PNG render of `heatmap.svg` from the app rasterizer |
| `synthetic-six.svg` | Editable SVG export. Labels are `<text>`. The curve is still a path. |
| `synthetic-six.figurezip` | Project package with `includeBundledFonts: true`, so the Noto files and OFL texts are inside |

The package places five SVGs and `heatmap.png` on a 180 mm artboard. Regenerate it from the current server with:

```bash
WRITE_EXAMPLE=1 pnpm --filter @panelstudio/server exec vitest run src/phase6.test.ts
```

That test also imports the committed package and checks that it reopens as six panels.
