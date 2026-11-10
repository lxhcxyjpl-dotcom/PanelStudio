export const interaction = {
  snapTolerancePx: 6,
  zoom: { min: 0.1, max: 4 },
  cropOutsideOpacity: 0.25,
  aiPromptRows: { default: 3, max: 8 },
  nudgeMm: { step: 0.1, shiftStep: 1 },
} as const;
