# PanelStudio

[中文](README.zh-CN.md)

PanelStudio is a local or self-hosted editor for multi-panel scientific figures. You import drawings you already made, the app proposes a layout and adds panel labels, and you export an SVG you can keep editing in Adobe Illustrator.

**Version 0.2.0** supports continuous refinement of an unapplied draft, comparison with its original revision, and acceptance or undo in one transaction. Existing schema-1 figures and project packages remain compatible. AI is optional.

## Refine a figure

1. Import up to eight existing panels and choose a layout.
2. Ask for changes to the full figure or a frozen selection. Keep refining the same draft, answer clarification questions, compare original and draft, then apply. You can edit while a proposal is being generated.
3. Drag individual labels, rigid groups or selected panels. Reorder the panel list to change lettering. Arrange two or three selected units into a row, preserving their sizes or using a common width or height.
4. Export editable SVG. The editor uses the bundled Noto faces to measure label ink and keeps text, supported vectors and raster images editable in their respective forms.

![Refining a six-panel draft](docs/acceptance-v0.2/workspace/03-refined.png)

[Reproducible project](examples/refinement-six/) · [Recorded walkthrough](docs/demo/v0.2-refinement.webm) · [Illustrator acceptance](docs/illustrator-compatibility.md)

On the tested Illustrator 30.7 installation, direct SVG import substituted a Medium face for three labels in the bold CJK sample. The font download includes a label-only restoration script. All five sets passed the native checks with the intended fonts after restoration.

## Run

Node.js 22.12 or newer, pnpm 10.33.4.

```bash
pnpm install --frozen-lockfile
pnpm --filter @panelstudio/server exec node start.mjs
```

In a second terminal:

```bash
pnpm --filter @panelstudio/web dev
```

Open `http://127.0.0.1:5173`. Full notes, including the data directory and `master.key`, are in [`docs/install.md`](docs/install.md).

The default data directory is `$HOME/.panelstudio`. `master.key` is created there when you save a model secret. It must never be committed.

The project menu opens another project on this server, soft-deletes the current one, or restores a deleted one. A deleted project keeps its files and history, rejects new edits, and cancels work that had not finished. The route audit is [`docs/v0.1-gap-close.md`](docs/v0.1-gap-close.md).

## Formats and limits

PNG, JPEG, WebP, and a documented subset of SVG. At most 8 panels in a project. Editable SVG keeps vectors and label text; it does not turn type into outlines. PDF, EPS, native `.ai`, and outline export are outside the supported formats.

Details: [`docs/format-support.md`](docs/format-support.md).

## Example

[`examples/synthetic-six/`](examples/synthetic-six/) is an original six-panel figure (MIT), with source drawings and a `.figurezip`.

## More

- [Test record](docs/test-record.md)
- [Illustrator checklist](docs/illustrator-compatibility.md)
- [Licenses, including the Noto OFL](docs/licenses.md)
- [Phase 6 notes](docs/phase-6-decisions.md)
- [v0.1 route audit](docs/v0.1-gap-close.md)
