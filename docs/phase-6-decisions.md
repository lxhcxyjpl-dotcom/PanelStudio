# Phase 6 implementation notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records narrow choices for the release preparation. It does not change a rule the handbook already states.

## Version

`APP_VERSION` is `0.1.0`. Layout stays `0.1.0`. SVG stays `0.1.0`. `ENGINE_VERSIONS.fontRegistry` stays `1` because that version identifies the family list, which is still Noto Sans and Noto Sans SC. The files are now in the repository. No git tag and no GitHub release were created.

## Fonts

Noto Sans Regular and Bold are static instances of `NotoSans[wdth,wght].ttf` from the Google Fonts `ofl/notosans` tree (`wdth=100`, `wght=400` and `700`). The character set is the full font. The files are 646,160 and 648,288 bytes.

Noto Sans SC Regular and Bold are static instances of a subset of `NotoSansSC[wght].ttf` (about 17 MiB). The official CJK OTF packages are larger than that. The committed faces are 2,613,908 and 2,614,340 bytes. The subset is Latin, Greek, the punctuation and symbol blocks listed in `fonts/README.md`, and GB/T 2312. `㐀` (U+3400) is outside the subset and is reported as a missing glyph. The typographic family name stays `Noto Sans SC`. The variable font’s default style name “Thin” is rewritten to Regular or Bold on these two instances so `font-weight` selects the file. That is the family’s own name, not an interface alias.

OFL texts are `fonts/OFL-NotoSans.txt` and `fonts/OFL-NotoSansSC.txt`, unmodified. The reserved name “Source” is not used.

`GET /api/v1/fonts` and `GET /api/v1/fonts/bundle` are implemented. Preview and PNG load the four files in resvg with `loadSystemFonts: false`. The browser loads the same files with `@font-face` for the label family names. The UI font stack is still the system stack.

Editable SVG keeps `font-family="Noto Sans"` or `font-family="Noto Sans SC"` on `<text>`. It does not embed the font bytes and does not convert text to outlines. `includeBundledFonts: true` copies the four files and the license texts into the `.figurezip` under `fonts/bundled/` and `fonts/licenses/`. It does not add `font.filesNotVendored`. `false` omits the binaries and does not warn.

`FONT_MISSING` / `font.notInstalled` is recorded only for a family that is not one of the two bundled names. Imported SVG keeps its own family string. A new label that uses a bundled face but needs a character that face does not cover uses `FONT_MISSING` with message key `font.missingGlyph`. The UI prints those message keys in Chinese and English. It does not print the raw code as the sentence.

## Example

`examples/synthetic-six/` is original geometry: paths, rectangles, circles, one gradient, and the text `n=24`. `heatmap.png` is a raster of `heatmap.svg`. The package was exported with `includeBundledFonts: true`. No third-party image is included.

## Data directory

`start.mjs` uses `$HOME/.panelstudio` unless `DATA_DIR` is set. The end-to-end script sets `DATA_DIR` to a temporary directory. `master.key` is created in the data directory when a provider secret is saved, mode `0600`. `.gitignore` ignores that filename. It is not in this commit.

## What this phase does not do

Illustrator was not run. Every row in `docs/illustrator-compatibility.md` is `needs manual check`. The in-app webm is a Playwright state sequence. It does not include Illustrator, and the sentence in it is answered by the phase 5 corpus stand-in. Project list, delete, and restore stay in the OpenAPI contract and are not implemented. No release tag was created.
