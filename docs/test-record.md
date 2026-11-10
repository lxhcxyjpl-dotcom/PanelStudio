# Test record

## v0.2.0 · 10 November 2026

Windows 11 25H2, build 26200.9711, Node.js 24.15.0, pnpm 10.33.4, Playwright 1.65.0 with Chromium 158.0.8127.18. Every integration or browser run used a dedicated development database. A repository checkout at `47a7011` provided the 0.1 comparison.

| Check | Actual result |
| --- | --- |
| Locked installation | Pinned dependency installation completed. Offline `pnpm install --frozen-lockfile` also succeeded with the warmed store. The Windows x64 SQLite binding in the locked package was verified by a real query. |
| `pnpm typecheck` | Exit 0 across nine workspace packages and apps. |
| `pnpm test` | **155 passed**. Contracts 32, core 19, text metrics 3, layout 27, SVG 7, AI 10, UI 3, web 9, server 45. |
| `pnpm test:e2e` | **24 passed** in a single fresh Chromium run. Playwright starts and closes the actual Fastify and Vite listeners in its global setup. |
| `pnpm build:web` | Exit 0. All four runtime font files were present in the built site. Vite reported a large JS chunk and deferred resolution of the four runtime font URLs. |
| Native Illustrator | Fresh SVGs, measured artboards, native text/path edits, panel translations, rasters, gradients, clipping, opacity and native reopen. Font-specific outcomes and numeric measurements are in the [Illustrator record](illustrator-compatibility.md). |

### Behaviors exercised

- Three AI turns replay to the last preview, one acceptance advances one revision, and one undo restores the original hash. Two clarification questions retain the original instruction, answers, selection and parent draft. Cross-project contexts, crossed selection boundaries, stale engines and limits of 10 turns and 64 cumulative commands are checked.
- A deliberately held ten-second provider request allows a manual drag to commit before the AI reply. The resulting draft is stale and read-only. Separate checks exercise cancel-then-send, late errors, late candidate thumbnails, project switching and reload/history recovery.
- Selection-row keeps unselected panels intact. Equal width in a 100 mm region with a 4 mm gap yields **48 × 24 mm and 48 × 48 mm**. Locks, partial groups, group scaling, obstacles, insufficient space, external constraints and strict conflicts are exercised.
- A real Chromium instance loaded the four bundled faces. SVG advance and actual painted ink were checked for white space, negative bearings, mixed CJK/Greek/Latin text and both weights. Pointer/keyboard tests cover rigid groups, multiselect, Shift-marquee, Esc, label nudges, list sorting, empty numeric fields, IME composition events, colors and reduced motion.
- Database tests upgrade v0.1 with committed WAL pages, preserve revisions, hashes, stacks, encrypted records, project-scoped asset identities and old job history, and check rollback and version rejection. Two imports and a re-export of the pre-existing six-panel package retained document hash `e3725040641ccc26a5eb7cc365423ded10ee74156de670909b882e0218caa53d` and all 24 asset entries byte-for-byte. A second import reused all blob files.
- The render job regression follows cancellation and deletion to terminal status, verifies the original revision’s PNG dimensions after a simultaneous edit, and checks that only the successful artifact and terminal event are published.
- The [20.2-second recording](demo/v0.2-refinement.webm) at 1440 × 900, [screen captures](acceptance-v0.2/workspace/) and [example](../examples/refinement-six/) come from the running application. AI responses and visual-review responses in automated tests come from controlled local providers. A production or hosted model was not used in this run.
- Native Windows IME candidate-window operation and a human using Illustrator’s Type/Pen tools were not hand-recorded. The IME composition behavior is browser-automated. Illustrator’s actual text and path objects were edited via its desktop API.

### Local baseline and environmental findings

The untouched 0.1 checkout passed type checking on Windows. Its standard unit command stopped on a byte comparison of CRLF vs LF in generated UI tokens. Its end-to-end launcher stopped on Bash reading CRLF at `set -euo pipefail`. The Linux record below is historical. v0.2 pins LF for generated snapshots, runs the browser servers without Bash, and uses the bundled SQLite native binary. Temporary test files were placed in a directory where the Windows process could perform atomic rename.

One full browser run during desktop-font testing exited with Windows status `0xC0000409` after nine cases. The cause was not established. A fresh isolated run completed all 24 tests and shut down successfully.

## Historical v0.1 Linux record

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
