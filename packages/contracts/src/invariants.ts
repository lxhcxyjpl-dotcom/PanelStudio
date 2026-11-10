/** Document invariants from handbook section 4.5. JSON Schema does not encode the cross-field rules. */
export const DOCUMENT_INVARIANTS = [
  {
    id: "order-permutation",
    text: "panelOrder and stackOrder are each an exact permutation of every panel id.",
  },
  {
    id: "drag-does-not-renumber",
    text: "Dragging a panel does not renumber it.",
  },
  {
    id: "stack-does-not-renumber",
    text: "Changing stack order does not renumber panels.",
  },
  {
    id: "labels-close-after-delete",
    text: "After a panel is deleted, automatic labels close up over the remaining panelOrder.",
  },
  {
    id: "single-group-membership",
    text: "A panel belongs to at most one edit group.",
  },
  {
    id: "groups-are-not-nested",
    text: "Edit groups are not nested.",
  },
  {
    id: "membership-only-on-groups",
    text: "Membership is stored only on groups. Panels do not store a groupId.",
  },
  {
    id: "ready-asset-in-project",
    text: "A panel may reference only a ready asset in the same project.",
  },
  {
    id: "crop-inside-unit-square",
    text: "A crop lies inside the unit square and its width and height are greater than zero.",
  },
  {
    id: "uniform-aspect",
    text: "A panel's width/height ratio matches the cropped asset's width/height ratio.",
  },
  {
    id: "committed-content-on-canvas",
    text: "A committed visible image and its label both lie on the real canvas.",
  },
  {
    id: "client-state-stays-out",
    text: "UI theme, UI language, zoom, selection, and API keys are not part of the document.",
  },
  {
    id: "auto-height-does-not-grow-on-drag",
    text: "heightMode auto does not grow the canvas while the user drags.",
  },
  {
    id: "canvas-resize-is-one-transaction",
    text: "A canvas-size change and the reflow performed for that change are submitted as one transaction.",
  },
] as const;
