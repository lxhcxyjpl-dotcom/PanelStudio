# Phase 5 implementation notes

The handbook in `PanelStudio-spec-v0.1.md` stays the source of truth. This file records narrow encodings for the AI adapter. It does not change a rule the handbook already states.

## What this phase runs

Phase 5 stores one OpenAI-compatible provider, runs provider tests, and turns a natural-language request into a validated intent and then existing domain commands. `APP_VERSION` is `0.1.0-phase5`. Layout stays `0.1.0`. SVG stays `0.1.0`. The font registry stays `1`. Font files are still not vendored.

These routes are live, in addition to the phase 4 routes:

- `GET` and `PUT /settings/ai-provider`
- `PUT` and `DELETE /settings/ai-provider/secret`
- `POST /settings/ai-provider/test`
- `POST /projects/:projectId/ai-layouts`
- `POST /jobs/:jobId/cancel`
- `GET /jobs/:jobId/events`

Accepting a proposal uses the existing `POST /transactions` body `{ baseRevision, candidateId }`. Undo uses the phase 2 history stacks. There is no second document model and no new domain command.

## Provider settings and the secret

No row means `{ configRevision: 0, hasSecret: false, config: null }`. A successful settings or secret write increments `configRevision`. Replaying the same idempotency key does not increment it again. Deleting a secret that is already absent does not increment it.

The secret is stored only after a config row exists. Saving it earlier is `REQUEST_INVALID`. The stored value is AES-256-GCM ciphertext (`v1.<iv>.<tag>.<ciphertext>`, base64url) with a fixed associated-data string. The 32-byte master key lives in `master.key` beside the database, mode `0600`, and is reused across restarts. Responses, job rows, logs, and the project package do not contain the secret. A URL with a username or password is rejected so the returned config cannot carry one.

`baseUrl` is stored as the user typed it. At call time the adapter removes a query, a fragment, and one trailing `/chat/completions` if the user included it, then appends `/chat/completions` once. Remote hosts must be HTTPS. `localhost`, a `.local` name, `::1`, and loopback or private IPv4 addresses are local. HTTP is allowed only for a local host, and only when `allowLocalEndpoint` is true. HTTPS to a local host also requires that flag. Redirects are not followed.

The model name is the configured string. The request uses `temperature: 0`. A provider test sends one short text completion and does not send an image, so `observedCapabilities.imageInput` is false and `structuredOutput` is the mode that was requested. A probe that is not a JSON object is `MODEL_OUTPUT_INVALID`.

## Jobs

`POST` returns 202 while the job is queued. The runner then claims it. Tests can set `deferAiJobs` and drain the queue themselves. A queued `ai_layout` or `provider_test` whose frozen `configRevision` no longer matches is failed with `PROVIDER_CONFIG_CHANGED` and is not sent. A running call is aborted and fails the same way if the revision changed before a candidate is saved. Missing config or secret fails the job with `PROVIDER_NOT_CONFIGURED`; the POST itself stays 202.

On process start, queued or running AI jobs are marked `SERVER_RESTARTED` and are not sent again. Transport failures, timeouts, non-2xx responses, and redirects are job failures with code `REQUEST_INVALID` and a message that does not include the URL, the response body, or the secret. The UI shows that message as a failed job. Invalid or incomplete model output, after one repair call, is `MODEL_OUTPUT_INVALID` and does not write a revision.

The model call budget is 3: the first parse, one repair, and one visual review. Visual review runs only when the request asks for it, the provider has `imageInput`, and a proposal compiled. It has no repair of its own. Invalid review JSON keeps the compiled proposal and adds an info diagnostic `AI_REVIEW_IGNORED`. A review proposal that fails compilation fails the job and saves no candidate.

SSE replays persisted events, honors `Last-Event-ID` and `?after=`, and writes a comment heartbeat every 15 seconds. Disconnecting the stream does not cancel the job. AI phases are names, not percentages.

## Compilation

The compiler accepts only a schema-valid `AIIntent`. Unknown panel or group ids, an empty `set_canvas`, an empty style patch, and a `relabel` list that is not every panel are `MODEL_OUTPUT_INVALID`. Locks, partial group edits, canvas bounds, and layout conflicts keep their existing codes. None of those paths write a revision.

Actions run in order on the document produced by the previous action. `set_gutter` is `layout.setSettings`. It does not invent a following layout; a reflow is a `layout` action in the same proposal. The section 20.3 gutter fixtures include that layout action. A `layout` action calls the existing solver with `maxCandidates: 1`. `validationMode` is `layout` when any action is `layout`, otherwise `edit`.

`move_by_mm`, `align`, and `distribute` use the phase 2 compilers and become one `panel.setFrames`. A group target expands to its members, and those compilers then move the group as one unit. `scale_to_width` uses `scalePanel` with the top-left anchor. There is still no equal-height action or command. The corpus fixture expresses “Make B and C the same height” as `scale_to_width` on the later panel so its height matches the earlier label, leaving that label’s frame and the later panel’s top-left corner unchanged. “A 稍微大一点” is the current width multiplied by `1 + 0.15`. The candidate summary appends the measured before and after sizes.

`align` uses the schema’s `canvas` or `target` reference. The top-align fixture uses the earlier panel as the target. Label `offsetMm` is absolute. The offset fixture places A one millimeter left of the automatic outside baseline (`x: -1`, `y: -gapMm`). Canvas background is fixed at `#FFFFFF`, so “换成白底黑字” sets the new label color to `#000000` and leaves the paper white. It does not recolor uploaded images.

The same document and the same intent produce the same commands. A candidate id is a UUID derived from the project, base revision, summary, and commands. `previewDocument` is `applyCommands` of those commands. Accept applies the stored commands through the existing transaction path and checks the stored hash. It does not call the model again.

## Undo and the workspace

The prompts `撤销`, `撤消`, and `undo`, after trim and without other text, are history actions. The AI tab calls the history endpoint and does not create a model request. If that prompt is posted anyway, the job succeeds as `unsupported` and does not change the document.

The AI tab shows the real scope, the section 20.3 examples, and three built-in presets. Choosing one only fills the field. While a proposal is previewed, the canvas shows its document and direct edits wait until the preview is discarded or applied. A proposal whose base revision is no longer current is stale: apply stays disabled and the saved document is left alone. Unconfigured AI leaves import, layout, edit, and export available.
