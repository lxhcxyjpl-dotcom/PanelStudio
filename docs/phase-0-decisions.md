# Phase 0 schema notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records places where the handbook is silent or where two sections describe different layers. The schemas do not rewrite a rule that the handbook already states.

## Left as the handbook wrote them

- Public `Candidate` (section 10.6) has no score. The `candidates` table stores `scoreJson`. The storage schema is `LayoutScore`, built from the section 7.8 weights. `previewDocument` is returned by the API and is not a stored column.
- `Job.progress` is an API and SSE field. The jobs table's necessary columns do not include it, so the row schema does not add a progress column. `cancelRequested` stays on the row and is not part of the API `Job`.
- Stored `primaryPanelId` is `UUID | null`. `LayoutRequest.primaryPanelId` is optional and is not null. Omission means the request does not override the stored value.
- `project_revisions.kind` is not enumerated. The schema is a non-empty string. Suggested labels `create`, `transaction`, `undo`, and `redo` are not enforced.
- Undo and redo stack JSON is not given a shape. The columns are unconstrained JSON. A possible encoding is an array of revision numbers, oldest first. That encoding is not enforced.
- `documentHash` is an opaque non-empty string. A lowercase SHA-256 hex digest of canonical JSON is a possible algorithm and is not enforced. Fields named `sha256` are lowercase hex SHA-256.
- Manual scale uses the opposite corner as the anchor (section 16.4). The AI action `scale_to_width` keeps the top-left and has no anchor field (section 12.5). Both would later compile to `panel.setFrames`.
- "Make B and C the same height" and the inspector's uniform-size action have no AI action and no domain command. None was added.
- Selection chrome is described as an outer white and inner dark-gray double stroke, without hex values. No stroke colors were invented.
- `defs` and `stop` are not named in the SVG preserve list. They are not added as extra elements. Basic gradients remain the handbook bullet. Presentation attributes are categories ("常见填充", "描边", "透明度", "虚线", "连接", "端点"), not a closed attribute allow-list.
- Illustrator acceptance tolerances (0.1 mm, 0.1 pt) are separate from the editor comparison tolerances (0.0001 mm, relative 1e-6).

## Encodings required to publish a schema

These are concrete JSON shapes for text that named a value but not the field envelope. They can be revised without adding a second document model.

| Topic | Encoding |
| --- | --- |
| Domain command envelope | `{ type, ...parameters }`. `type` is the handbook command name, matching the AI example's `type`. |
| Whole-object commands | `label.setStyle` carries `labelStyle`. `canvas.set` carries `canvas`. `layout.setSettings` carries `layoutSettings`. List parameters that the handbook already names stay `items`. |
| `resetTextOverrides` | Required boolean. The table's `:false` is the usual value. Clearing custom text must be stated. |
| Omitted `panel.add` crop | Handler uses `{x:0,y:0,width:1,height:1}`. The JSON field has no schema default, so an omitted field stays omitted on the wire. |
| Numeric labels | `panelOrder` index 0 formats as `1`. Alpha index 0 formats as `A` / `a`. |
| Default label `visible` | `true`. The default row shows A, B, C. |
| Original media types | IANA types `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, one-to-one with PNG, JPEG, WebP, and SVG. |
| Group and constraint membership | `minItems: 2`, from groups dissolving below two members and from row/equal constraints. |
| Command and proposal arrays | `minItems: 1`. A transaction allows at most 64 commands. |
| AI `align` | `edge` is `left`, `right`, `top`, `bottom`, `centerX`, or `centerY`. `reference` is `{kind:"canvas"}` or `{kind:"target", target}`. |
| AI style patches | `set_label_style` and `set_panel_label` use a `patch` object, as in the handbook JSON example. Override patch values may be `null` to clear an override. |
| AI layout job result | `kind` is `candidates`, `clarification`, or `unsupported`. |
| Layout candidate response | `{ candidates: Candidate[] }` with at most 3 items. Cursor pages stay `{items, nextCursor}`. `nextCursor` is `null` when the page ends. |
| Pagination | `limit` is an optional integer from 1 to 100, with no default. `includeDeleted` defaults to false. |
| Idempotency-Key | Required on state-changing POSTs and on provider setting writes (`PUT` settings, `PUT` secret, `DELETE` secret). Not required on GET, project rename, project delete, or asset delete. Max length 200. |
| Multipart field | The file part is named `file`. |
| Thumbnail | `image/png`. |
| Success statuses | Transactions, undo, and redo use 200. Routes the handbook marks as 202 stay 202. Job cancel uses 202. |
| Job state | Non-terminal jobs have null `finishedAt`, `result`, and `error`. Success has a result and a timestamp. Failure has an error and a timestamp. Cancellation has a timestamp and a null error. |
| Revision rows | `baseRevision` and `targetRevision` are nullable. `commandsJson` is a `DomainCommand[]` and may be empty. `documentJson` is `FigureDocumentV1`. |
| Provider row | One `AIProviderConfig` plus `encryptedSecret`, `configRevision`, and `updatedAt`. |
| Artifact row | `revision` and `candidateId` are nullable. `blobPath` is storage-only. |
| Preview width | Integer from 1 to 16,000, the PNG single-edge limit. |
| Cross-field invariants | Crop containment, aspect ratio, id permutations, and on-canvas labels are listed in `DOCUMENT_INVARIANTS`. JSON Schema does not encode them, and phase 0 does not implement the geometry engine. |
| Empty crop that crosses the unit square | `{x:0.8,width:0.5}` currently passes the schema. The invariant still forbids it. |
| App and engine versions | Health `appVersion` is `0.1.0-phase0`. Layout and SVG engine versions are `0.0.0` because those compilers are not in this phase. Font registry version is `1`. Font files are not vendored. |
| Theme stylesheet | CSS custom properties replace `.` with `-`, so `ui.surfaceElevated` is `--ui-surfaceElevated`. `color-scheme` is a user-agent hint beside the tokens, not a new color. Document paper and the default label color stay `#FFFFFF` and `#000000` in both themes. |
| TypeBox package | `@fastify/type-provider-typebox` 6 peers `typebox` 1.x. The workspace uses `typebox` 1.4.6, the current TypeBox line, rather than the legacy `@sinclair/typebox` 0.34 package. |

Width shortcuts remain 85, 120, and 180 mm. 120 mm is both a width shortcut and the default canvas height. The default width stays 180 mm.
