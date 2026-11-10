# Format support and limits

Normative list: handbook sections 1.2, 1.3, 1.4, 3.2, and 5.4, encoded in `packages/contracts`. This page does not add formats.

## Import

| Format | Media type | What is kept |
| --- | --- | --- |
| PNG | `image/png` | Embedded image. Orientation 1 is stored again as PNG. |
| JPEG | `image/jpeg` | Original bytes, plus a PNG derivative with EXIF orientation applied. |
| WebP | `image/webp` | Original bytes, plus a PNG derivative. |
| SVG | `image/svg+xml` | Supported vectors stay vectors. The file is not rasterized into the editable SVG. |

One project holds at most 8 panels and 32 library assets. Auto layout applies to 2–8 panels and returns at most 3 different candidates.

## SVG catalog

`SVG_SUPPORT.catalogVersion` is `1`.

Preserved:

- Containers: `svg`, `g`
- Shapes: `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`
- Text: `text`, `tspan`
- Common fill, stroke, opacity, dash, join, and cap
- `clipPath` that the samples accept
- Basic linear and radial gradients
- Embedded PNG and JPEG
- Internal `use` that can be expanded safely
- Basic transforms already in the source SVG

`defs`, `linearGradient`, `radialGradient`, and `stop` are how those gradients are stored. An attribute outside the working presentation set fails the import instead of being stripped, except non-visual leftovers (`data-*`, `aria-*`, comments, `metadata`, Adobe private data).

Rejected. A feature that would change the picture is an error, not a silent deletion:

- Script, event attributes, animation
- `foreignObject`
- External images, external CSS, remote fonts
- `filter`, complex `mask`, `pattern`
- Unimplemented `marker`, `textPath`, `vector-effect`
- References that cannot be expanded reliably
- Cycles, abnormal depth (the reader uses 64), and content over the resource limits

Normalization parses without executing or loading external resources, strips a plain SVG doctype that has no internal subset, refuses internal entities, bakes supported CSS into attributes, bakes the root `viewBox` and `preserveAspectRatio`, expands allowed internal `use`, and removes old Adobe private editing data. The same asset used twice gets per-panel id prefixes at instantiation. The shared asset cache is not rewritten.

Imported text keeps its `font-family`. It is not rewritten to Noto. A family other than `Noto Sans` or `Noto Sans SC` is a `font.notInstalled` warning. Preview falls back to Noto Sans for drawing only.

## Export

| Format | What you get |
| --- | --- |
| SVG | Editable SVG. New labels are `<text>` with the real family name and a numeric `font-size`. Text is not converted to outlines. Font bytes are not embedded. |
| PNG | A raster of that same SVG at 150, 300, or 600 DPI. The default is 600. DPI does not change the document size. |
| `.figurezip` | `manifest.json`, `document.json`, originals, normalized assets, thumbnails, a preview when rasterization works, and a font list. Bundled fonts and OFL texts are included only when `includeBundledFonts` is true. |

The package does not include history, secrets, model settings, logs, or AI chat. Re-import creates a new project at revision 0.

## Size limits

| Limit | Default |
| --- | ---: |
| Panels per project | 8 |
| Assets per project | 32 |
| One upload | 25 MiB |
| Original bytes per project | 200 MiB |
| One raster decode | 50 megapixels |
| SVG elements | 100,000 |
| Commands in one transaction | 64 |
| AI prompt | 4,000 characters |
| Custom label | 16 Unicode scalar values, one line |
| PNG output | 60 megapixels, 16,000 px on a side |
| Uncompressed project package | 512 MiB |

Over the limit, the API returns a specific error. Animated rasters are rejected.

## Out of scope for v0.1

From handbook section 1.3. These are not in this release:

- Import of PDF, EPS, or native `.ai`
- Editing path nodes of an imported SVG in the browser
- Reconstructing curves, axes, or text from a screenshot
- Changing data, axis ranges, or statistics inside a panel
- General arrows, rich-text callouts, or flowcharts
- Multiple artboards, collaboration, accounts, or billing
- Export that converts fonts to outlines
- Automatic physical-scale calibration
- An MCP server, a skill package, or a desktop installer

## 格式与限制（摘要）

可导入 PNG、JPEG、WebP 和受支持的 SVG。一个项目最多 8 个面板、32 个素材。单个上传 25 MiB。脚本、滤镜、外链、`foreignObject`、复杂 mask 和 pattern 会被拒绝。导出的 SVG 保留文字和矢量，不转曲，也不把整张矢量图栅格化。PNG 可选 150、300、600 DPI，默认 600。v0.1 不导入 PDF、EPS 或 `.ai`，不在网页里改路径节点，也不提供字体转轮廓。
