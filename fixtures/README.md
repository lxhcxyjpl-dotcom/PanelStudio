# Fixtures

Phase 1 mixed set:

- `mixed/raster.png` — 80×40 PNG with transparency.
- `mixed/photo.jpg` — 60×40 JPEG.
- `mixed/panel-vector.svg` — basic shapes, text, a linear gradient, and a clipPath. The phase 1 test places this asset twice.
- `raster/exif-orientation-6.jpg` — 30×16 JPEG with EXIF orientation 6. Import should display it as 16×30 and keep these original bytes.
- `rejected/script.svg` — script, which must fail import.
- `expected/mixed-panels.svg` — sample editable export of the mixed set. Illustrator still has to be checked by a person.

Handbook section 21.2 lists further goldens for later phases. Those are not all present yet.

Phase 3 layout cases live in `layout/`. Each file is a compact panel list the layout tests expand into a `FigureDocumentV1`; it is not a second document model. The set covers 2–8 panels, a locked panel, a rigid group, a hero primary, and an unsatisfiable hard-constraint pair.
