# Phase 2 implementation notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records narrow encodings for the edit kernel. It does not change a rule the handbook already states.

## What this phase runs

Phase 2 applies every domain command in the phase 0 union. `layout.setSettings` stores the settings and does not run layout. Align, distribute, equal width, and equal height are not commands. Callers compile them to one `panel.setFrames` and submit that command in one transaction. The auto-layout families, candidate scoring, the three-column workspace, i18n, and AI stay later phases.

`APP_VERSION` is `0.1.0-phase2`. `ENGINE_VERSIONS` is unchanged: SVG `0.1.0`, layout `0.0.0`, font registry `1`. Font files are still not vendored.

These routes are live, in addition to the phase 1 routes:

- `POST /projects/:projectId/transactions` for every domain command
- `POST /projects/:projectId/history/undo`
- `POST /projects/:projectId/history/redo`

`POST` with `candidateId` still returns `NOT_FOUND`. Project rename, delete, restore, asset delete, revision reads, previews, layout, AI, SSE, and font-bundle routes stay in the OpenAPI contract and are not implemented.

## Geometry

`panel.setCrop` keeps the source origin from handbook section 6.3. The scale is the frame-width scale. Restoring the previous crop restores the previous frame. The original asset bytes are not rewritten.

`panel.setFrames` is a move or a uniform scale. A size that does not match the cropped asset fails with `DOCUMENT_INVALID`. The handler does not correct the aspect and does not grow an `auto` canvas.

Corner scale keeps the opposite corner fixed, as in section 16.4. Specifying the width derives the height from the current frame aspect, and the reverse. The top-left anchor is the default used by equal-size and by the AI action `scale_to_width`.

`panel.replaceAsset` shows the new asset in full. The frame is the largest uniform fit inside the old frame, and the old center is unchanged. The panel name is left as it was. A grouped panel is `GROUP_PARTIAL_EDIT` even when the fitted frame matches. A locked panel is `LOCKED_ELEMENT` when the frame or the crop would change. Replacing the asset id alone, with the same full crop and the same frame, is not in the panel lock list, so that no-op-sized asset swap is allowed on a locked ungrouped panel.

A crop that only differs inside `1e-6`, and a frame that only differs inside `0.0001 mm`, are treated as unchanged so a repeated command does not trip a lock. Real edits use the submitted numbers. Nothing is clamped onto the canvas. `OUTSIDE_CANVAS` rejects the transaction.

## Align, distribute, and equal size

There is still no align, distribute, or equal-height command.

| Operation | Compilation |
| --- | --- |
| Align | One `panel.setFrames`. Edges are the contract's `left`, `right`, `top`, `bottom`, `centerX`, and `centerY`. |
| Distribute | One `panel.setFrames`. Equal gaps on `horizontal` or `vertical`. The first and last units stay put. Two units do not move. |
| Equal height or equal width | One `panel.setFrames`. The reference is the earliest `panelOrder` id. Other frames keep their top-left corner. The free side follows the current frame aspect. |

The inspector's align-to-selection uses the union of the units being aligned. Align-to-canvas and align-to-a-panel or a group are the same compiler with a different reference. Align does not pack items, so they may overlap. Overlap, margins, and row or equal-size constraints stay soft for manual edits: the transaction is not `LAYOUT_CONFLICT`, and phase 2 does not emit those hints.

A grouped panel is one unit. Every member receives the same `dx` and `dy`, including a member that was not in the selection. Sizes stay the same, which is the only grouped change `panel.setFrames` accepts. Equal size does not expand a group. Scaling one member is `GROUP_PARTIAL_EDIT`.

Arrow-key distances are `NUDGE_MM` (`0.1` and `1`). The kernel does not time-merge repeats. The client sums a burst into one `panel.setFrames` before it posts the transaction.

## Groups, locks, and deletion

Lock and group rules run on each command. Crop containment, aspect, and the canvas run on the final document, so `canvas.set` and the `panel.setFrames` that reflows it can share one transaction. `canvas.set` never moves panels by itself.

`LOCKED_ELEMENT` is a panel with `locked: true`, or any panel in a group with `locked: true`, when the command would move, scale, crop, or delete it. `panel.replaceAsset` uses that code only when the frame or crop changes. Rename, label edits, `panel.setStackOrder`, `panel.setLocked`, and `group.remove` are not geometry. Dissolving a locked group is allowed. The member `locked` flags stay.

`GROUP_PARTIAL_EDIT` is any grouped change that is not one shared translation with unchanged sizes. That includes a crop, a scale, or a replacement. Deleting members of an unlocked group is the normal `panel.remove` path, not a partial edit. A group with fewer than two remaining members is deleted. An unlocked group can lose one member and keep the rest.

`panel.remove` drops the ids from `panelOrder` and `stackOrder` without reordering the survivors. A constraint with fewer than two remaining members is dropped. If the removed panel was `primaryPanelId`, that field becomes `null`. A locked member, or a member of a locked group, rejects the whole remove.

`group.create` starts unlocked. A panel that is already grouped, or a second use of the same group id, is `DOCUMENT_INVALID`. Grouping the current primary panel fails the existing primary-panel invariant. Clear the primary in the same transaction first.

## Stack and labels

`panel.setStackOrder` does not change `panelOrder`. The stack menu compiles to that command:

| Menu | Move |
| --- | --- |
| 置于顶层 | `front`, last in `stackOrder` |
| 上移一层 | `forward` |
| 下移一层 | `backward` |
| 置于底层 | `back`, first in `stackOrder` |

An identity move is an unchanged transaction.

`label.setStyle` still keeps per-panel overrides. `panel.reorderLabels` replaces `panelOrder`. `resetTextOverrides: true` sets every `labelOverrides.text` to `null` and leaves the other override fields. `false` keeps custom text. Empty text is still not a way to hide a label.

## History, idempotency, and autosave

Phase 1 stored `undoStackJson` and `redoStackJson` as revision numbers, oldest first. This phase reads those stacks.

A changing transaction pushes the previous revision and clears redo. Undo pops the last undo revision, copies that immutable document into a new revision, and pushes the revision being left onto redo. Redo does the symmetric thing. Kinds are `undo` and `redo`. `commandsJson` is `[]`. `targetRevision` is the snapshot that was copied. `baseRevision` is the client's revision. The new revision number is always one higher. Snapshots are not rewritten.

An empty undo or redo stack is `REQUEST_INVALID` and is not stored, so a later request can reuse the key. A stale `baseRevision` is `REVISION_CONFLICT`. Undo and redo share the idempotency scope `history:<projectId>`. The same key with a different body is `IDEMPOTENCY_KEY_REUSED`. A matching replay returns the first response and does not append another revision.

An unchanged document does not create a revision and does not move either stack. Failed command checks are not stored.

Autosave is that commit. The project file is the source of truth. Opening the same data directory in a new process restores the current document, the revision, and both stacks. IndexedDB crash drafts belong to the phase 4 workspace and are not a second document model.

## Errors without a new code

A history stack that points at a missing revision returns `NOT_FOUND`. The catalog has no empty-history code, so an empty stack stays `REQUEST_INVALID`. Soft layout hints are not returned on manual edits in this phase.
