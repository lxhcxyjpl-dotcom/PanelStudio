# Test record

Recorded 10 November 2026 on Linux, Node.js 22.23.4, pnpm 10.33.4. Commands were run from the repository root. Browser tests used Playwright Chromium 158.0.8127.18. The default viewport is 1440×900 CSS pixels. This record is separate from the Illustrator checklist.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0. Done in 3.2s. |
| `pnpm typecheck` | Exit 0. contracts, ui, core, svg, layout, web, ai, server. |
| `pnpm test` | Exit 0. 119 tests, 22 files. Counts below. |
| `pnpm exec playwright install --with-deps chromium` | Exit 0 |
| `pnpm test:e2e` | Exit 0. 15 tests in Chromium, 26.1s, with `PANELSTUDIO_SHOTS` and `PANELSTUDIO_VIDEO` unset. |

`pnpm test` by package:

| Package | Files | Tests |
| --- | ---: | ---: |
| `@panelstudio/contracts` | 6 | 30 |
| `@panelstudio/ui` | 1 | 3 |
| `@panelstudio/core` | 2 | 15 |
| `@panelstudio/svg` | 1 | 7 |
| `@panelstudio/layout` | 1 | 21 |
| `@panelstudio/ai` | 1 | 9 |
| `@panelstudio/web` | 1 | 5 |
| `@panelstudio/server` | 9 | 29 |

Playwright:

| File | Tests | What they drive |
| --- | ---: | --- |
| `apps/web/e2e/ai.spec.ts` | 6 | Unconfigured AI, a corpus-stand-in proposal, invalid model output, provider test, cancel, stale proposal |
| `apps/web/e2e/projects.spec.ts` | 1 | Project menu: open another project, soft-delete, restore, and the panel is still there |
| `apps/web/e2e/workspace.spec.ts` | 7 | Import, auto layout, SVG export, keyboard undo, failed SVG, save failure, layout conflict, English and dark theme, widths 1440 / 1280 / 1024, reduced motion |
| `apps/web/e2e/walkthrough.spec.ts` | 1 | Six drawings, auto layout, the sentence `把 C 放左边作为主图` through the corpus stand-in, SVG export |

This run did not set `PANELSTUDIO_SHOTS` or `PANELSTUDIO_VIDEO`. The screenshots and `docs/demo/in-app-walkthrough.webm` are still the phase 6 capture.

Server tests cover import and export, the edit kernel, layout candidates, AI jobs, the font cmap, PNG text using the bundled faces, `includeBundledFonts`, reopening `examples/synthetic-six/synthetic-six.figurezip`, and project list, soft-delete, restore, and revision reads.

## Not automated

- Every Illustrator row in `docs/illustrator-compatibility.md`. No Illustrator process was launched. Thresholds 0.1 mm and 0.1 pt were not measured on a file opened in Illustrator.
- The five mixed-material Illustrator sets required by handbook section 21.5.
- Handbook section 21.4 timings (drag frame rate, candidate latency on a stated machine, time to interactive, PNG not blocking the API). No numbers are claimed.
- 200% browser zoom, and a manual pass at 1280 and 1024 beyond the automated column-width checks.
- Chinese IME composition.
- A download blocked by the browser.
- A hosted model. AI tests use the in-repo corpus stand-in or a refused response. They do not call a paid API.
- A human screen recording of the Illustrator step. The committed webm is the Playwright in-app sequence only.
