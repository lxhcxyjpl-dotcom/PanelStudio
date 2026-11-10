# Phase 4 implementation notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records narrow encodings for the workspace. It does not change a rule the handbook already states.

## What this phase runs

Phase 4 is the three-column workspace in `apps/web`. It talks to the Phase 1–3 HTTP API. It does not reimplement layout, SVG compilation, or the document model. `APP_VERSION` stays `0.1.0-phase3` because the schema, OpenAPI document, and engines are unchanged.

The client keeps the handbook split:

- `confirmed` is the last server document, revision, hash, and history flags.
- A gesture or crop preview is display-only and is not a revision.
- A failed save keeps one pending command list in memory and in IndexedDB. That draft is the document plus the unconfirmed commands. It is not a second project, and the recovery JSON says it is not a `.figurezip`.

Zustand holds view state: theme, locale, selection, camera, crop draft, and which layout candidate is being previewed. TanStack Query loads health and the asset library. Radix dialogs and menus are the project, stack, settings, export, and recovery surfaces.

## Routes this phase turns on

`PATCH /projects/:projectId` renames the project row. It does not change the revision or the undo stack. `DELETE /projects/:projectId/assets/:assetId` sets `removedFromLibraryAt` when the current document does not reference the asset, and returns `ASSET_IN_USE` when it does. Bytes stay available to older revisions.

Project soft-delete, restore, the project list, SSE, and AI routes stay in the OpenAPI contract and are not called. The project menu therefore offers new, package import, reload, and shortcuts. It does not show a delete control. Reload uses the last project id stored in the browser; there is no project picker because `GET /projects` is not implemented.

## Workspace

The design width is 1440 CSS px. At ≥1280 the columns start at 240 and 304 and can be dragged inside 208–320 and 280–360. At 1024–1279 they are fixed at 208 and 280. Below 1024 the sidebars are drawers. Below 768 the inspector drawer is not shown; zoom, the panel list, and export stay available. The 1 px divider is separate from the column width. Its hit target is 8 px and, at ≥1280, arrow keys resize it.

Empty project copy, per-file import status, SVG rejection, save, offline, revision conflict, layout conflict, stale candidates, empty undo/redo, font missing, and reload restore are all visible. A disabled control has a reason in `title`. There is no reject-candidate route: 取消 drops the preview and leaves the saved document alone.

Layout requests `family: "auto"`. Cards render the server `summary`, the preview document’s canvas size, diagnostics, and a PNG from `POST /previews` when that job succeeds. English UI replaces only the known prefixes `均衡分行`, `主图在左`, and `主图在上`; the shape suffix stays. The first returned candidate is shown as a preview and does not write history. 使用此布局 posts `{ baseRevision, candidateId }`. A candidate is stale when its `baseRevision` no longer matches, or when the server returns `CANDIDATE_STALE`. The handbook does not define a separate expiry time.

## Editing

Dragging, scaling, nudging, align, distribute, equal size, and stack order compile through `@panelstudio/core` and are submitted as domain commands. The browser does not run the layout solver. Corner scale keeps the opposite corner fixed. Arrow keys move the selection by `NUDGE_MM` and collapse a burst into one `panel.setFrames` after 320 ms. Snapping uses a 6 px tolerance and pauses while Alt is held. Scale does not snap, because moving one edge independently would break the uniform scale.

Distribute is disabled below three objects because two objects do not move. A grouped panel scales and crops only after ungroup; the control explains that. Crop is one `panel.setCrop` on 完成. Escape cancels it. An out-of-range crop disables 完成.

Canvas `+` and `-` zoom the view. Ctrl or Meta plus wheel, which is how a trackpad pinch arrives, zooms at the pointer. Ctrl+Plus is left to the browser so page zoom stays available. Shift+1 fits the window. Shift+0 sets 100%. View changes are not history.

## Theme, type, motion, language

Colors come from `packages/ui` tokens. The selection stroke is outer `document.paper` and inner `#333333`, the handbook’s 深灰 artwork preset. No theme token stays dark gray in both themes, so that preset is the named color rather than a new hex. The same preset outlines the scale handles. Document paper and label colors stay on the document; the inspector shows the white canvas background as read-only.

Motion durations and the easing curve are the handbook values. Reduced motion, from the system setting or the explicit control, sets spatial durations and the press scale to 0 and caps opacity fades at 80 ms. Reduce transparency paints scrims with `ui.surfaceElevated`.

`zh-CN` and `en-US` are the only installed packs. i18next uses one namespace and `keySeparator: false`, so the handbook prefixes (`toolbar.import`, and the rest of section 20.2) are flat keys. Missing keys fall back to English. Switching language does not reload the project, rewrite label text, or renumber panels. A project title or group name created while one language is active stays as written.

## AI and fonts

The AI tab shows the real scope (all panels, the selection, or the group), a prompt, and the section 20.3 examples. Choosing an example or a saved browser preset only fills the field. Send explains that this phase does not call a model. 应用修改 stays disabled for that reason. No proposal, preview, or stage text is invented. Provider setup and the AI job states belong to phase 5.

Font files are still not vendored. The status line names Noto Sans and Noto Sans SC and says preview uses the system font stack. Export diagnostics surface `FONT_MISSING` from the server. The package option that asks for bundled fonts reports the same warning.

## Save and recovery

A transaction is “saved” only after the server responds. Invalid commands revert the optimistic preview. Network loss, HTTP 5xx, and `REVISION_CONFLICT` keep the draft, offer retry, reapply onto the server revision when that revision was fetched, discard, and download the recovery JSON. IndexedDB is only that crash draft. Opening the same project in a new page loads the server document and, if a draft is still stored, asks before applying it.
