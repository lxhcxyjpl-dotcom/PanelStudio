# PanelStudio

[中文](README.zh-CN.md)

PanelStudio is a local editor for assembling existing plots into multi-panel scientific figures. Import your panels, compare layouts, adjust sizes and labels on the canvas, and export an SVG you can keep editing in Adobe Illustrator.

**Latest development preview** · [PanelStudio 0.2.0](https://github.com/lxhcxyjpl-dotcom/PanelStudio/tree/design/editorial-studio) adds image-aware selection of main and supplementary panels, layout changes by conversation, and one-step undo. The quick start below runs the v0.1.0 default branch.

Run PanelStudio locally in a browser with no PanelStudio account. Import, layout, editing and export work without an API key. To give layout instructions in plain language, connect a compatible model in the AI settings.

![Layout candidates for six imported scientific panels](docs/screenshots/03-layout.png)

## Quick start

Use Node.js 22.12 or newer and pnpm 10.33.4. In the first terminal, download the source, install dependencies and start the backend.

```bash
git clone https://github.com/lxhcxyjpl-dotcom/PanelStudio.git
cd PanelStudio
pnpm install --frozen-lockfile
pnpm --filter @panelstudio/server exec node start.mjs
```

Open a second terminal in the `PanelStudio` directory and start the web app.

```bash
pnpm --filter @panelstudio/web dev
```

Keep both terminals running and open [the local workspace](http://127.0.0.1:5173). Projects and images are stored in `$HOME/.panelstudio` on the machine running the backend. Installation, data and self-hosting details are in the [setup guide](docs/install.md).

## Formats and limits

PNG, JPEG, WebP, and a documented subset of SVG. At most 8 panels in a project. Editable SVG keeps vectors and label text; it does not turn type into outlines. PDF, EPS, native `.ai`, and outline export are out of scope for v0.1.

Details: [`docs/format-support.md`](docs/format-support.md).

## Example

Try the original [six-panel example](examples/synthetic-six/) (MIT). It includes source drawings and a `.figurezip` project. The [recorded walkthrough](docs/demo/in-app-walkthrough.webm) shows import, layout and SVG export. It uses a local test model for the example layout request.

## More

- [Test record](docs/test-record.md)
- [Illustrator compatibility checklist](docs/illustrator-compatibility.md)
- [Licenses, including the Noto OFL](docs/licenses.md)
- [v0.1 handbook](docs/PanelStudio-spec-v0.1.md)
- [Phase 6 notes](docs/phase-6-decisions.md)
- [v0.1 route audit](docs/v0.1-gap-close.md)
