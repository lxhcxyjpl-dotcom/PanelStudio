# PanelStudio editorial design system

Implementation baseline: `c3d15b44a3ad0afcd35aac74001c5cb9b9cac278`. Branch: `design/editorial-studio`. This document records the confirmed phase-two design as implemented, with the user's later four-size requirement taking precedence over larger type in the initial design proposal.

## Brand and type

The brand mark is three unequal rectangles, suggesting a primary panel and supporting panels. The mark is original; no Anthropic or Apple logo or imagery is distributed. The homepage follows an editorial opening, a visual demonstration, Arrange / Refine / Export, recent projects, then editable examples and documentation.

| Role | Font | Size at the default browser setting |
| --- | --- | --- |
| Homepage English headline | Newsreader | 56 px; 24 px below 768 px |
| Chinese headline | Noto Sans SC | 56 px; 24 px below 768 px |
| Section/dialog heading and wordmark | UI family / Newsreader wordmark | 24 px |
| UI body and ordinary controls | Inter, Noto Sans SC | 15 px |
| Tabs, field labels, status, captions | Inter, Noto Sans SC | 13 px |
| Dimensions and numerical data | Geist Mono, fallback monospace | 13 or 15 px |

There are **only four UI sizes: 13 / 15 / 24 / 56 px**, expressed in rem. Browser text scaling remains effective. The scientific figure is a separate document: its labels, axes and imported SVG text retain their original units and sizes. No extra miniature homepage labels are introduced.

The five new web font files total 149.2 KiB, with OFL notices, source hashes and a reproducible subset builder in `apps/web/public/brand-fonts/`. Existing Noto measurement/export files are unchanged.

## Semantic colors

| Role | Light | Dark |
| --- | --- | --- |
| Page / brand paper | #F7F7F5 | #1C1C1B |
| Workspace behind the figure | #EEEEEC | #191919 |
| Panel surface | #FFFFFF | #242423 |
| Main text | #252525 | #F1F1ED |
| Muted text | #666666 | #AEAEAA |
| UI accent | #9B4F35 | #E0A087 |
| Brand terracotta | #C47755 | #D69274 |
| Scientific paper | #FFFFFF | #FFFFFF |

The executable source of truth is `packages/ui/src/theme.ts`, with its generated `tokens.css` and contrast tests. The darker UI accent supports text contrast; the lighter terracotta is reserved for the mark and small brand details. UI theme changes never rewrite document colors, assets or export options.

## Geometry and components

- Desktop header: 60 px; canvas toolbar: 40 px; status bar: 24 px. Left panel defaults to 240 px, adjustable between 208–320; right defaults to 352 px, adjustable between 320–420. At 1024 px, panels use 208 and 320 px. Below 1024 they become drawers; below 768 they become bottom sheets with four persistent section entries.
- Homepage content max-width: 1440 px, with 80 / 48 / 32 / 20 px side padding by breakpoint. Large sections use 48–96 px vertical separation. Body text has a 1.7–1.8 line height; controls and editorial captions stay at normal UI density.
- Inspector sections use 24 px block and 20 px inline padding. XY and width/height fields are paired. Ordinary controls are 36 px high; homepage primary actions are 48 px. Touch-oriented rows and drawer controls provide 44 px targets.
- Radius: 6 px buttons/inputs, 8 px menus, 12 px dialogs. Asset and candidate rows are mostly planar. Shadows belong to overlays and white scientific paper, not every content block.
- Tabs have a 2 px selected underline and a roving tab stop. Left/right arrows and Home/End move between tabs without moving artwork. Fields retain accessible labels; disabled actions expose reasons. Focus rings use semantic focus colors, 2 px width and offset. Dialogs use Radix focus trapping and close controls.
- Selection borders use the UI accent. Artwork colors are not borrowed for selection indicators. Dragging, resizing, panning and the actual document scene have no interpolated geometry animation.

## Interaction and motion

The existing `packages/ui/src/motion.ts` remains the timing source: 100 ms hover, 70 ms press, 140 ms tabs/menus, 180 ms dialogs/sidebars, 200 ms proposal effects, with `cubic-bezier(0.2, 0, 0, 1)`. Reduced motion removes spatial transitions.

The homepage cycles four actual exports once, 5.5 seconds per image. The eight-stage recorded editing demonstration advances every 2.8 seconds while visible, then stops. Users can pause, select stages, compare original/refined geometry, replay and download the actual SVG. Leaving the viewport pauses progression; backgrounding the page stops autoplay. Reduced motion presents the final state and keeps manual controls. The demonstration's geometric transitions are 420 ms and apply only to recorded presentation snapshots, never to pointer-driven artwork.

## Editor states

| State | Right panel behavior |
| --- | --- |
| No selection | Canvas size, spacing, constraints, global label style |
| One panel | Position, proportion, crop/lock, inline label typography and placement |
| Multiple panels | Local row, alignment/distribution, equal sizing, shared font/size/weight/color |
| Layout task | Real candidates, dimensions, diagnostics, Apply/Cancel; canvas viewport stays fixed |
| AI task | Frozen scope, current structured changes, original/draft comparison, Apply/Discard, continued refinement; history is collapsed |
| Original/draft preview | Corresponding document properties are read-only until returning to editing |

The canvas does not acquire a bottom candidate dock. Layout and AI statuses stay with their task; artwork diagnostics are grouped in one disclosure. Save failures keep an actionable recovery flow. Export selects one format at a time and shows the confirmed revision; an unapplied proposal is never silently exported.

## Routes and persistence

`/` is the brand homepage; `/app` resumes the last project or offers the existing project-start flow; `/app/:projectId` opens a deep link. A lightweight History API adapter avoids a new routing dependency.

Returning home keeps the editor mounted, so its camera, selection, active panels and AI input remain available. Navigation blurs committed fields, cancels transient gestures, settles nudges and imports, waits for saved transactions, and stops on unresolved recovery or crop work. Browser back/forward follows the same guard. Late project loads cannot overwrite a more recent navigation. A refresh can recover a locally retained draft. Missing/deleted/offline project entries have explicit recovery routes.

## Evidence and remaining review

See [phase-two delivery](editorial-implementation.md) for actual runtime images, comparison, recording and test results. Screenshots establish the implemented presentation; they do not substitute for the user's visual approval or the separate native Illustrator checks.
