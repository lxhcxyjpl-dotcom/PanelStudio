export const motion = {
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  durationMs: {
    buttonHover: 100,
    buttonPress: 70,
    tab: 140,
    menu: 140,
    dialog: 180,
    sidebar: 180,
    layoutCandidate: 200,
    aiPreview: 200,
    fitWindow: 180,
    guideFade: 180,
    drag: 0,
  },
  menuOffsetPx: 4,
  dialogOffsetPx: 8,
  buttonPressScale: 0.985,
  reducedMotion: {
    spatialDurationMs: 0,
    maxOpacityDurationMs: 80,
  },
} as const;
