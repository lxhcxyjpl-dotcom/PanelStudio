# UI and brand typefaces

Newsreader, Inter and Geist Mono are distributed under SIL OFL 1.1. The full license texts in this directory retain the original copyright notices. `sources.json` pins the downloaded upstream TTF URLs and SHA-256 hashes; `build.json` records the actual WOFF2 files used by this build.

These are Latin UI subsets, covering `U+0020–024F`, `U+2000–206F`, `U+2190–21FF` and `U+2212`. Newsreader retains weights 400–500 at optical size 56; Inter has static weights 400/500/600 at optical size 14; Geist Mono has static weight 400. The five files total **152,736 bytes (149.2 KiB)**. They use `font-display: swap`. Chinese UI falls back to the existing Noto Sans SC face.

Rebuild with `python scripts/build-brand-fonts.py`, or provide `--sources-dir <directory>` containing the three original TTFs. This requires `fonttools[woff]` and Brotli. The builder checks source hashes before writing these files. It never modifies `fonts/`, the Noto measurement engine, SVG labels or export font packages.
