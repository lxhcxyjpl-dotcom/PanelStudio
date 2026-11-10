const themeTokenNames = [
  "ui.background",
  "ui.workspace",
  "ui.surface",
  "ui.surfaceElevated",
  "ui.surfaceInset",
  "ui.surfaceHover",
  "ui.surfacePressed",
  "ui.borderSubtle",
  "ui.borderStrong",
  "ui.textPrimary",
  "ui.textSecondary",
  "ui.textMuted",
  "ui.textDisabled",
  "ui.primaryFill",
  "ui.primaryText",
  "ui.selectedFill",
  "ui.focusRing",
  "ui.accent",
  "ui.accentSoft",
  "ui.success",
  "ui.scrim",
  "ui.shadow",
  "document.paper",
  "document.labelDefault",
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];

type ThemeColors = Record<ThemeTokenName, string>;

export const themeTokens = {
  light: {
    "ui.background": "#FAF9F5",
    "ui.workspace": "#ECEAE3",
    "ui.surface": "#FAF9F5",
    "ui.surfaceElevated": "#FFFEFB",
    "ui.surfaceInset": "#F1EFE8",
    "ui.surfaceHover": "#EEEBE3",
    "ui.surfacePressed": "#E6E1D7",
    "ui.borderSubtle": "#DEDAD0",
    "ui.borderStrong": "#958F82",
    "ui.textPrimary": "#24231F",
    "ui.textSecondary": "#58564F",
    "ui.textMuted": "#6D695F",
    "ui.textDisabled": "#A5A095",
    "ui.primaryFill": "#25241F",
    "ui.primaryText": "#FFFEFB",
    "ui.selectedFill": "#EBE6DA",
    "ui.focusRing": "#9B4932",
    "ui.accent": "#A14B34",
    "ui.accentSoft": "#F3E4D9",
    "ui.success": "#577051",
    "ui.scrim": "#28251D4D",
    "ui.shadow": "#352A1717",
    "document.paper": "#FFFFFF",
    "document.labelDefault": "#000000",
  },
  dark: {
    "ui.background": "#22221F",
    "ui.workspace": "#2A2A25",
    "ui.surface": "#262622",
    "ui.surfaceElevated": "#30302A",
    "ui.surfaceInset": "#252520",
    "ui.surfaceHover": "#36352F",
    "ui.surfacePressed": "#444138",
    "ui.borderSubtle": "#46443B",
    "ui.borderStrong": "#858074",
    "ui.textPrimary": "#F2EFE5",
    "ui.textSecondary": "#C6C1B4",
    "ui.textMuted": "#B0AA9D",
    "ui.textDisabled": "#817B70",
    "ui.primaryFill": "#ECE9DD",
    "ui.primaryText": "#262520",
    "ui.selectedFill": "#423D33",
    "ui.focusRing": "#E8A085",
    "ui.accent": "#F0AB8D",
    "ui.accentSoft": "#47352B",
    "ui.success": "#A5BA92",
    "ui.scrim": "#12120E9E",
    "ui.shadow": "#0000003D",
    "document.paper": "#FFFFFF",
    "document.labelDefault": "#000000",
  },
} as const satisfies { light: ThemeColors; dark: ThemeColors };

export function themeCustomProperty(token: ThemeTokenName): string {
  return `--${token.replaceAll(".", "-")}`;
}

export function renderThemeCss(): string {
  const block = (selector: string, theme: keyof typeof themeTokens) => {
    const declarations = (Object.keys(themeTokens.light) as ThemeTokenName[]).map(
      (token) => `  ${themeCustomProperty(token)}: ${themeTokens[theme][token]};`,
    );
    return `${selector} {\n  color-scheme: ${theme};\n${declarations.join("\n")}\n}`;
  };
  return `${block(':root,\n:root[data-theme="light"]', "light")}\n\n${block(':root[data-theme="dark"]', "dark")}\n`;
}
