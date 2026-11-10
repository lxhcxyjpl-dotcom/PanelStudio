# PanelStudio

科研多面板排版编辑器。导入已有子图，排版并添加面板编号，导出可在 Adobe Illustrator 中继续编辑的 SVG。

PanelStudio is an MIT-licensed local or self-hosted web editor for multi-panel scientific figures. The normative handbook is [`docs/PanelStudio-spec-v0.1.md`](docs/PanelStudio-spec-v0.1.md).

## Phase 0

This repository currently contains the phase 0 contract:

- TypeBox schemas for the document, domain commands, and HTTP API
- OpenAPI 3.1 document at [`docs/openapi.json`](docs/openapi.json)
- Defaults, error codes, the SVG support catalog, and theme tokens
- A pnpm workspace with exact dependency versions and a lockfile

Import, editing, layout, AI calls, and export are not implemented. `apps/web` is a shell that loads the theme tokens. It is not the editor and it has no controls.

Handbook gaps that the schemas had to encode are recorded in [`docs/phase-0-decisions.md`](docs/phase-0-decisions.md). That note does not replace the handbook.

## Develop

Node.js 22 LTS and pnpm 10.33.4.

```bash
pnpm install
pnpm typecheck
pnpm test
```

`pnpm-lock.yaml` is the reproducible install. Workspace manifests pin exact versions.
