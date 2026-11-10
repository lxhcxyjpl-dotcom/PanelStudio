# Phase 1 implementation notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records narrow encodings for things the handbook names without a field envelope, and for the Phase 1 slice of later-phase work. It does not change a rule the handbook already states.

## What this phase runs

Phase 1 implements import of PNG, JPEG, WebP, and catalog SVG; `panel.add`, `label.setStyle`, and `label.setOverrides`; revisioned document save with idempotency; an editable SVG compiler; PNG rasterization of that SVG; and `.figurezip` import/export.

These routes are live:

- `GET /health`, `GET /capabilities`
- `POST /projects`, `GET /projects/:projectId`, `GET /projects/:projectId/document`
- `POST/GET` asset routes needed to upload, list, read, and download original, normalized, and thumbnail bytes
- `POST /projects/:projectId/transactions`
- `POST /projects/:projectId/exports` for `svg`, `png`, and `project`
- `POST /project-imports`
- `GET /jobs/:jobId`, `GET /artifacts/:artifactId/download`

Layout, AI, undo/redo HTTP, previews, project rename/delete, asset delete, SSE, and font-bundle routes stay in the OpenAPI contract and are not implemented. `POST` with `candidateId` returns `NOT_FOUND` because no candidate is stored. Any other domain command is validated by the shared schema and then rejected with `DOCUMENT_INVALID` and the message that it is not available in phase 1. The command union is unchanged.

Import does not modify the document and does not request layout candidates. The client places panels with `panel.add`.

## Versions

`APP_VERSION` is `0.1.0-phase1`. `ENGINE_VERSIONS.svg` is `0.1.0`. Layout stays `0.0.0`. Font files are still not vendored; the font registry stays at `1`. Revision rows store `ENGINE_VERSIONS.svg` in `engineVersion`.

## Document hash and history stacks

`documentHash` is the lowercase SHA-256 of canonical JSON: objects have sorted keys, arrays keep their order, and there is no insignificant whitespace. That is one allowed opaque encoding from the phase 0 note.

`undoStackJson` and `redoStackJson` are arrays of revision numbers, oldest first. A changing transaction pushes the previous revision and clears redo. Undo and redo HTTP handlers are not in this phase, so those stacks are written for the next phase and not yet consumed. `canUndo` and `canRedo` follow the array lengths.

Unchanged transactions return `changed: false` and do not create a revision. Successful idempotent responses are stored and replayed. A reused key with a different request hash returns `IDEMPOTENCY_KEY_REUSED`. Failed command validation is not stored, so a corrected retry can proceed. Asset, export, and project-import successes are stored, including the case where the import job itself failed, so the same upload does not create a second asset or project.

## Jobs

Asset import, export, and project import run inline in the request after the bytes are parsed, then return 202. The job row is inserted in its terminal state. `job_events` still records `job.queued`, `job.started`, and `job.completed` or `job.failed`. Decode and SVG work happen outside the SQLite write transaction. A worker process is later deployment work; PNG rendering is not on the editable-SVG path.

`progress` stays null. There is no progress column.

## Files and asset rows

Blob paths are extra SQL columns (`originalBlobPath`, `renderBlobPath`, `thumbnailBlobPath`). They are not part of `AssetRowSchema` or any API body. Bytes are written to a content-addressed file with temp file, hash check, and rename before the database row becomes visible.

`panel.add` sets `name` to the asset's original filename. The command has no name field. `locked` is false. Label overrides start as all null (inherit). The panel id is appended to both `panelOrder` and `stackOrder`. Omitted `cropNormalized` becomes the full crop `{x:0,y:0,width:1,height:1}` on the document; the stored command keeps the field omitted.

Raster policy:

- PNG with EXIF orientation 1 is stored again as the PNG render, so the derivative bytes match the original.
- Any other orientation, and every JPEG or WebP, is rotated and written as a PNG derivative. WebP and JPEG originals stay in storage and in the package.
- Notes record color space, EXIF orientation, and whether an ICC profile was present. Pixels are not sharpened or recolored on purpose.
- Multi-frame rasters fail the import job with `UNSUPPORTED_MEDIA_TYPE`.
- Thumbnails are PNG, longest edge 256, without enlargement.
- SVG thumbnails are resvg renders of the normalized SVG. resvg is not used to build the editable SVG.

Unrecognized bytes return HTTP 415 and create no asset. A recognized SVG that fails the catalog becomes a failed asset plus a failed job with `SVG_UNSUPPORTED_FEATURE`; the original bytes remain downloadable. Malformed SVG uses that same job code because the catalog has no separate parse code. Non-UTF-8 XML declarations are rejected the same way.

Library count includes every asset that has not been removed, including failed ones. The 25 MiB limit applies to asset uploads. Project-package uploads use the 512 MiB uncompressed cap instead, because a package can legally hold more than one 25 MiB original. The multipart plugin allows up to 512 MiB and the asset handler enforces 25 MiB. Zip64, encrypted entries, symlinks, and methods other than store or deflate are rejected. Declared uncompressed size is checked before inflate, and the actual inflated total is checked again. A package that lies about uncompressed size can still expand before the second check; the import then fails and no project row is kept.

## Labels

Automatic placement, because font files are not vendored and there is no outline measurement yet:

- Outside top left: baseline `(frame.x, frame.y - gapMm)`.
- Inside top left: baseline `(frame.x + gapMm, frame.y + gapMm + fontSizeInUserUnits)`.
- `offsetMm` is added to the frame origin and wins over placement.
- The on-canvas box uses 0.8em ascent, 0.2em descent, and 0.7em advance per Unicode code point.
- A hidden label is omitted from the SVG rather than emitted with `display="none"`.
- `font-family` is the bundled family name (`Noto Sans` or `Noto Sans SC`), and `font-size` is `pt * 25.4 / 72` in user units. 9 pt is `3.175`.

Export adds a `FONT_MISSING` warning for each family used by a label or by imported SVG text. That warning means the server did not embed a font file. It does not mean the family name was replaced.

## SVG normalization and instances

`defs`, `linearGradient`, `radialGradient`, and `stop` are how basic gradients are represented. `clipPath` is kept when its children are otherwise supported. The phase 0 catalog text is unchanged; this is the encoding of those handbook bullets.

Presentation attributes are still categories. The working set used by the importer is the fill, stroke, opacity, dash, line-join, and line-cap properties, plus the geometry, text, gradient, and clip attributes those elements need. An attribute outside that set fails the import instead of being stripped, except non-visual editor leftovers (`data-*`, `aria-*`, Adobe-namespaced data, comments, `metadata`, `enable-background`, `pointer-events`, `cursor`). Comments and Adobe private elements are removed with a normalization note because they do not paint. A standard SVG DOCTYPE with no internal subset is stripped and never fetched. Internal entities, external stylesheets, scripts, event attributes, filters, masks, patterns, markers, `textPath`, `vector-effect`, animation, and `foreignObject` fail the import.

CSS is limited to element, class, id, and universal selectors with descendant and child combinators. Supported declarations are written back as presentation attributes. `@import`, external `url()`, and script-like values fail. `@font-face` is dropped with a note.

Internal `use` is expanded. Cycles, missing targets, and `use` of the root `svg` fail. Cloned subtrees receive new ids so expansion does not duplicate ids. `symbol` and nested `svg` references need a positive width and height.

Element depth above 64 is the phase 1 reading of abnormal depth. The element cap remains 100,000. Duplicate source ids fail the import.

The root `viewBox` and `preserveAspectRatio` are baked into a group. The normalized viewport is that viewport in CSS pixels (96 px per inch). Percent widths fall back to the viewBox size. A viewport clip preserves the root overflow clip. Source `clipPath` and gradient elements stay in the same transformed group as the content they paint, so user-space coordinates still match. Nested `svg` elements are preserved rather than flattened.

Instantiation does not rewrite the stored normalized SVG. Each panel prefixes source ids with `panel-{panelId}--`. Structural ids stay `panel-{panelId}`, `panel-{panelId}-content`, `panel-{panelId}-label`, and `panel-{panelId}-crop`. The double hyphen keeps a source id of `content` distinct from the content group. `url(#...)` and `href="#..."` / `xlink:href="#..."` are rewritten from the copy.

The crop clip is on the content group only. The label is a later sibling in the panel group. Raster panels use an embedded PNG `image` with both `href` and `xlink:href`. Vector panels insert the instantiated elements. The white canvas is a `rect`, not the SVG background property alone. `includeMetadata: true` adds a `<metadata>` text node with `{format, schemaVersion, revision}` and no Adobe payload. Coordinates use at most six decimal places.

Crop cross-field checks use an absolute epsilon of `1e-6` on the unit square. Aspect uses the handbook relative tolerance `1e-6`. On-canvas checks use `0.0001 mm`.

## Project package

Extension `.figurezip`, media type `application/zip`. Paths:

- `manifest.json` (not listed inside `files`, because its hash would be circular)
- `document.json`
- `fonts/dependencies.json`
- `preview.png` when resvg can rasterize the compiled SVG
- `assets/{assetId}/original.{png|jpg|webp|svg}`
- `assets/{assetId}/render.{png|svg}`
- `assets/{assetId}/thumbnail.png`
- `assets/{assetId}/asset.json` with filename, media type, diagnostics, and `normalized`

`files` lists every path except `manifest.json`. Ready library assets are packed even when the current document does not reference them. Failed assets are not packed. `includeBundledFonts: true` does not embed font binaries; the export adds a `FONT_MISSING` warning with message key `font.filesNotVendored`. If preview rasterization throws, the package is still written and a `PREVIEW_UNAVAILABLE` warning is added.

Import creates a new project at revision 0 with kind `import`, always assigns new asset ids, and rewrites `panel.assetId`. Panel ids are kept. Asset `importJobId` is the project-import job. Asset `createdAt` is the import time. The packaged normalized bytes are restored as stored after the manifest hashes and `renderSha256` are checked; import does not normalize them again. The document is checked with the same invariants as `panel.add`. A failed import does not insert a project row. Orphan content-addressed blobs can remain after a failed write and are not a project.

## Errors without a perfect catalog code

Unexpected faults return HTTP 500 with the shared error envelope and `code: "REQUEST_INVALID"`, message `Unexpected server error.` The catalog has no internal-fault code. Import jobs that fail for a non-catalog reason use `DOCUMENT_INVALID`.
