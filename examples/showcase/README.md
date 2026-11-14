# Original synthetic showcase

Four editable example projects power the editorial homepage: single-cell, molecular, microscopy, and experimental figures. All values and pixels are synthetic; no patient, donor, animal or experimental data are included. These images do not establish biological findings.

`generate.py` uses NumPy seed `20261113`, Matplotlib and the repository's Noto font to create the raw inputs in `assets/`. The cell map is a Gaussian illustration, not a computed UMAP. Microscopy is procedural fluorescence without a calibrated scale. The band image is schematic, and the bars do not report an inferential test. See [data notes](assets/DATA-NOTES.md).

The public files in [`apps/web/public/showcase`](../../apps/web/public/showcase/) are generated through PanelStudio's real server, in a temporary database:

1. Import and normalize each source asset.
2. Place panels through the editor's domain-command builder.
3. Request and accept a real automatic layout candidate.
4. Translate B and C by 2 mm in a second transaction.
5. Export SVG, PNG and `.figurezip` using the normal artifact jobs.
6. Reopen every package and compare the exported document hash.

The catalogue records the imported, arranged and refined geometry, label baselines, document hashes and export checksums. The homepage replays these snapshots, explicitly identifies the replay, and makes no live model request. Opening an example imports a new project; it does not replace an existing one. Scientific artwork is unaffected by the surrounding UI theme.

```powershell
python examples/showcase/generate.py
node scripts/build-showcase.mjs
```

Python dependencies: NumPy, Matplotlib, Pillow. The Node command uses the pinned repository dependencies. UUIDs and project timestamps are new on each build; synthetic values and command sequence are repeatable. The four package reopens were verified during this implementation. The separate native Illustrator suite uses five compatibility fixtures; it is not a per-example manual sign-off.

Original code and drawings are MIT licensed under the root LICENSE. The bundled typefaces retain their OFL notices.
