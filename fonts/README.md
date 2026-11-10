# Bundled fonts

PanelStudio v0.1 ships two families for labels, preview, and PNG rendering:

| File | Family name in the file | Weight |
| --- | --- | --- |
| `NotoSans-Regular.ttf` | Noto Sans | 400 |
| `NotoSans-Bold.ttf` | Noto Sans | 700 |
| `NotoSansSC-Regular.ttf` | Noto Sans SC | 400 |
| `NotoSansSC-Bold.ttf` | Noto Sans SC | 700 |

Editable SVG keeps these family names on `<text>` elements. Text is not converted to outlines, and the font bytes are not embedded in the SVG. Preview and PNG load these files. A project package includes them only when `includeBundledFonts` is true. `GET /api/v1/fonts/bundle` always returns the files with the license texts in this directory.

## Noto Sans

Static instances of the variable font `NotoSans[wdth,wght].ttf` published in the [Google Fonts `ofl/notosans`](https://github.com/google/fonts/tree/main/ofl/notosans) tree (upstream [notofonts/latin-greek-cyrillic](https://github.com/notofonts/latin-greek-cyrillic), copyright 2022 The Noto Project Authors). Instances use `wdth=100` and `wght=400` or `wght=700`. The character set is the full font: Latin, Greek, and Cyrillic. It is not a subset. License: `OFL-NotoSans.txt`.

## Noto Sans SC

The variable font `NotoSansSC[wght].ttf` from [Google Fonts `ofl/notosanssc`](https://github.com/google/fonts/tree/main/ofl/notosanssc) is about 17 MiB, and the official Noto CJK OTF packages are larger. Those files are not stored in this repository. The committed Regular and Bold files are static instances (`wght=400` and `wght=700`) of a subset of that variable font.

The subset keeps:

- ASCII, Latin-1, Latin Extended-A and Extended-B
- Greek and Coptic, and Greek Extended
- general punctuation, superscripts and subscripts, currency, letterlike symbols, number forms, arrows, math and technical operators, enclosed alphanumerics, geometric shapes, and miscellaneous symbols
- CJK radicals, Kangxi radicals, CJK symbols and punctuation, Bopomofo, CJK strokes, enclosed CJK letters
- vertical and compatibility forms
- halfwidth and fullwidth forms
- every character encoded by GB/T 2312

The typographic family name stays **Noto Sans SC**. The variable font’s default style name (“Thin”) is rewritten on these two instances to Regular or Bold so `font-weight` 400 and 700 select the matching file. That is the family’s own name, not an interface alias. License: `OFL-NotoSansSC.txt` (Copyright 2014–2021 Adobe, Reserved Font Name “Source”). The reserved name “Source” is not used.

A label that needs a character outside this subset is reported as a missing glyph. Switch the label to a font that contains it, or change the label. Imported SVG text is not rewritten to Noto.

## Names

`name` ID 1 and, when present, ID 16 are the family above. ID 2 / ID 17 are Regular or Bold. OS/2 `usWeightClass` is 400 or 700.
