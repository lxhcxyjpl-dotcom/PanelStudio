export const uiFontFamily =
  '"Inter", "Noto Sans SC", "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

export const uiFontSizes = { caption: 13, body: 15, heading: 24, display: 56 } as const;

export const uiType = {
  projectTitle: { fontSizePx: uiFontSizes.body, lineHeightPx: 22, fontWeight: 600 },
  sectionTitle: { fontSizePx: uiFontSizes.heading, lineHeightPx: 32, fontWeight: 600 },
  control: { fontSizePx: uiFontSizes.body, lineHeightPx: 22, fontWeight: 400 },
  caption: { fontSizePx: uiFontSizes.caption, lineHeightPx: 18, fontWeight: 400 },
  emptyTitle: { fontSizePx: uiFontSizes.display, lineHeightPx: 63, fontWeight: 500 },
  emptyBody: { fontSizePx: uiFontSizes.body, lineHeightPx: 22, fontWeight: 400 },
  numeric: { fontSizePx: uiFontSizes.body, lineHeightPx: 22, tabularNums: true },
} as const;
