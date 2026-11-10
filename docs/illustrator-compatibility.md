# Illustrator compatibility

Browser tests and Illustrator tests are separate. Nothing in this table is an Illustrator pass. Illustrator was not available when this page was written, so every row is **needs manual check**.

Thresholds, from handbook section 21.5 and `ILLUSTRATOR_ACCEPTANCE`:

- Artboard and key positions: within **0.1 mm**
- New label font size: within **0.1 pt**
- No missing glyphs, dropped images, or unexpected clipping
- Native vectors and text stay editable within the supported set

These are not the editor tolerances (`0.0001 mm`, relative `1e-6`).

## Manual procedure

1. Install **Noto Sans** and **Noto Sans SC**, Regular and Bold, from `fonts/` or from **下载内置字体** in the export dialog (`GET /api/v1/fonts/bundle`). The family names in the files are `Noto Sans` and `Noto Sans SC`.
2. Open `fixtures/expected/mixed-panels.svg` with **File → Open**.
3. Export a fresh SVG from the app (for example the project in `examples/synthetic-six/`, or any current figure) and open that file the same way. `examples/synthetic-six/synthetic-six.svg` is one export already in the repo; a human check still needs a file opened from Illustrator, not only a file that exists on disk.
4. Repeat the checklist on at least five mixed sets. Record the operating system, the full Illustrator version, whether the Noto fonts were installed, the date, the materials, screenshots, and problems.

No set has been opened in Illustrator for this release.

## Checklist

| # | Check | Status |
| --- | --- | --- |
| 1 | Open the exported SVG with File → Open (文件 → 打开). | needs manual check |
| 2 | Check the artboard size in millimetres. | needs manual check |
| 3 | Select and move each panel on its own. | needs manual check |
| 4 | With the Type tool, change A to X. | needs manual check |
| 5 | Edit native text that came from an imported SVG. | needs manual check |
| 6 | Edit a curve that came from an imported SVG. | needs manual check |
| 7 | Confirm each raster panel is still its own image. | needs manual check |
| 8 | Check crop, opacity, fonts, and gradients. | needs manual check |
| 9 | Save as `.ai`. | needs manual check |
| 10 | Close the file and open it again. | needs manual check |
| 11 | Export a comparison PNG and look at it beside the app preview. | needs manual check |

## Record (empty until a person runs the check)

| Field | Value |
| --- | --- |
| Operating system | |
| Illustrator version | |
| Noto Sans / Noto Sans SC installed | |
| Date | |
| Materials | |
| Screenshots | |
| Problems | |
