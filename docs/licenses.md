# Dependency and font licenses

PanelStudio is MIT licensed. See the root `LICENSE`. Copyright 2026 lxhcxyjpl-dotcom.

The table is the license field of each direct dependency at the locked version. Transitive packages stay in `pnpm-lock.yaml`. This is a summary, not a legal opinion.

| Package | Version | License field |
| --- | --- | --- |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| vite | 8.3.7 | MIT |
| vitest | 5.1.0 | MIT |
| fastify | 5.12.8 | MIT |
| @fastify/multipart | 9.4.0 | MIT |
| @fastify/type-provider-typebox | 6.3.0 | MIT |
| typebox | 1.4.6 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| sharp | 0.35.5 | Apache-2.0 |
| @resvg/resvg-js | 2.6.2 | MPL-2.0 |
| i18next | 27.1.0 | MIT |
| react-i18next | 18.0.1 | MIT |
| zustand | 5.1.0 | MIT |
| @tanstack/react-query | 5.107.1 | MIT |
| fflate | 0.8.3 | MIT |
| ajv-formats | 3.0.1 | MIT |
| @xmldom/xmldom | 0.9.12 | MIT |
| @radix-ui/react-dialog | 1.3.1 | MIT |
| @radix-ui/react-dropdown-menu | 2.2.1 | MIT |
| @radix-ui/react-popover | 1.3.1 | MIT |
| @radix-ui/react-tooltip | 1.4.1 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| playwright | 1.65.0 | Apache-2.0 |
| @playwright/test | 1.65.0 | Apache-2.0 |

`@resvg/resvg-js` is MPL-2.0. That license applies to that package. PanelStudio’s own source stays MIT. `sharp` is Apache-2.0 and ships its own native binaries; notices for those binaries are in the sharp package.

## Fonts

Noto Sans and Noto Sans SC are SIL Open Font License 1.1. The texts shipped with the files are:

- `fonts/OFL-NotoSans.txt` — Copyright 2022 The Noto Project Authors
- `fonts/OFL-NotoSansSC.txt` — Copyright 2014–2021 Adobe, with Reserved Font Name “Source”

The font files may be bundled with this software. They are not sold by themselves. The reserved name “Source” is not used. Details of the SC subset and the static instances are in `fonts/README.md`.

`GET /api/v1/fonts/bundle` and a project package with `includeBundledFonts: true` include those OFL texts next to the font files.

The example drawings in `examples/synthetic-six/` are original and MIT licensed. See `examples/synthetic-six/LICENSE.md`.
