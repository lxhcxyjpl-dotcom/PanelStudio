# Phase 3 implementation notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records narrow encodings for the layout engine. It does not change a rule the handbook already states.

## What this phase runs

Phase 3 searches the four layout families, scores them, and stores at most three different candidates. `layout.setSettings` still only stores settings. The engine reads those settings when a layout is requested.

`APP_VERSION` is `0.1.0-phase3`. `ENGINE_VERSIONS.layout` is `0.1.0`. SVG stays `0.1.0`. The font registry stays `1`. Font files are still not vendored. `LayoutScore.scoringVersion` is the layout engine version.

These routes are live, in addition to the phase 2 routes:

- `POST /projects/:projectId/layout-candidates`
- `GET /projects/:projectId/candidates/:candidateId`
- `POST /projects/:projectId/previews` for a revision or a candidate
- `POST /projects/:projectId/transactions` with `candidateId`

There is no reject route. Leaving a candidate unaccepted is the reject action. AI, SSE, project rename and delete, asset delete, and the three-column workspace stay in the OpenAPI contract and are not implemented.

## Families and search

`rows` partitions the unit sequence into rows of 1–3 units, preserving order. `hero-top` places the primary alone on the first row and partitions the rest the same way. `hero-left` places the primary in the left column and the same partitions in the right column. `auto` searches every applicable family.

Hero families are applicable when the effective primary is an ungrouped panel. `rows` does not need one. A hero request without one is `REQUEST_INVALID`. Stored `primaryPanelId` is used when the request omits `primaryPanelId`. The request value is not written back into `layoutSettings`.

Default order walks `panelOrder` and emits a group unit at the group's first member. Grouped panels cannot also appear as `panel:` units. Explicit `rows` are either the full layout or, for hero and for `auto`, only the secondary region with the primary omitted. Explicit `orderedUnitIds` replace the default order and are then partitioned. Layout order does not change `panelOrder`.

Hero-left column width is the root of left height minus right height. Both columns start at the top of the margin box. Bisection runs for every hero-left candidate, including the all-scalable case, for 64 iterations. The root must land within the geometry tolerance of `0.0001 mm`. A root outside the legal column interval eliminates that partition. Groups are not scaled, so the right-hand height is only weakly increasing; the same bisection covers that case.

## Labels, groups, and canvas height

Outside labels reserve `gapMm` plus the phase 1 em ascent above the frame. The next row's content starts at least one vertical gutter below the previous row, and further down when the next label needs more than that gutter. Inside labels do not reserve a band above the frame. A label may overlap its own frame. It may not overlap another panel's frame or label.

A group is one unit. Members keep their sizes and their relative positions and receive one shared translation. A locked panel, or any member of a locked group, must land on its current frame. The search does not pack around an arbitrary locked obstacle. If every partition would move a lock, the response is `LAYOUT_CONFLICT` and the saved document stays as it was.

`heightMode: auto` sets the canvas height from the occupied bottom plus the bottom margin, and rejects a candidate above `maxAutoHeightMm`. `heightMode: fixed` keeps the current or overridden height, allows leftover space, and rejects a candidate that does not fit. Nothing is stretched or cropped to make it fit. `canvasOverride.heightMm` is used only when the effective height mode is `fixed`. In `auto`, that field is ignored because the height is computed.

## Hard constraints and score

Section 7.7 is applied as written. For automatic layout these eliminate a candidate: invalid numbers or references, aspect ratio, locks, canvas bounds, group rigidity, safety margins, overlap with another panel or its label, `row` / `equalWidth` / `equalHeight` constraints, and `minPanelSizeMm`. Raster PPI is not one of those. A low PPI adds `LAYOUT_PPI_BELOW_TARGET` warnings and a readability penalty. It does not, by itself, become `LAYOUT_CONFLICT`.

The task brief grouped overlap, margins, and equal-size constraints with PPI as soft. That grouping does not match the section 7.7 column for automatic layout, so those three still eliminate candidates. They become `LAYOUT_CONFLICT` only when every candidate has been eliminated. A document that still has one valid candidate returns that candidate.

When nothing survives, the reported ids prefer locks, then explicit constraints, then minimum size, then overlap, then margins, then height, then a row that cannot fit the width. Constraint failures accumulate every constraint id from the attempts that failed that check.

Penalties follow the section 7.8 weights. Unknown terms are dropped and the remaining weights are renormalized. `total` is null only when every term is unknown; movement, whitespace, and height are known for a normal document.

| Penalty | Encoding |
| --- | --- |
| Readability | Mean shortfall of raster PPI against `targetRasterPpi`. No raster panels makes the term `unknown`. |
| Whitespace | `1 - (sum of frame areas / canvas area)`, clamped to 0–1. Source-image margins are not measured. |
| Emphasis | Absolute difference between the primary's area share and the expected share, divided by the expected share. Expected share is `1 / panelCount` for `rows` and `0.5` for hero. No primary makes the term `unknown`. |
| Consistency | `(max - min) / max` of the related panels' heights. Related panels are every panel except the primary, or every panel when there is no primary. Fewer than two related panels makes the term `unknown`. |
| Height | Absolute difference from `preferredHeightMm`, divided by that preference. |
| Movement | Mean of half the move (as a fraction of the original canvas diagonal) and half the relative width change. |

This score is not an aesthetic judgment. Isomorphic candidates share a geometry key quantized to `0.0001 mm`. One key keeps the lower score, then `rows` before `hero-top` before `hero-left`. The response is that list sliced to `maxCandidates` (default 3). A shorter list is not padded.

## Candidates, preview, and accept

A candidate's commands are `panel.setFrames` for every panel when any frame changes, then `canvas.set` when the canvas width, height, or height mode changes. Frames that land within `0.0001 mm` of the current frame keep the current numbers, so a lock that already sits on the template is unchanged. `previewDocument` is `applyCommands` of those commands. The layout package does not write the caller's document.

The candidates table stores commands, score, diagnostics, and the result hash. `previewDocument` is not a column. `GET` rebuilds it by applying the stored commands to the base revision. The same idempotency key replays the first response. A new key for the same document and request returns the same candidate ids, because the id is a UUID derived from the project, revision, engine, commands, summary, and score.

Accepting a candidate goes through the existing transaction path. The client's `baseRevision` must match the project, and the candidate's base revision, layout engine version, and font registry version must match too. A mismatch of the candidate is `CANDIDATE_STALE`. A mismatch of the client's revision is `REVISION_CONFLICT`. The stored commands are applied and the result hash is checked. A passing accept is one undoable revision. An empty command list would not move the undo stack; the search does not emit an empty command list for a real move.

`POST /previews` rasterizes the candidate's derived document, or a stored revision, and writes a preview artifact. It does not change the project revision. Ignoring that artifact leaves the saved document as it was.

## Errors without a new code

A layout below two panels or above eight is `REQUEST_INVALID`. A missing measurement asset is `DOCUMENT_INVALID`. PPI warnings use the code `LAYOUT_PPI_BELOW_TARGET`, which is a diagnostic, not a new catalog error. Preview pixel limits that exceed the PNG caps use `EXPORT_TOO_LARGE`.
