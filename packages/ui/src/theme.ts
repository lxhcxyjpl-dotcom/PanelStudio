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
  "ui.scrim",
  "ui.shadow",
  "document.paper",
  "document.labelDefault",
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];

type ThemeColors = Record<ThemeTokenName, string>;

export const themeTokens = {
  light: {
    "ui.background": "#F5F5F7",
    "ui.workspace": "#E8E8EB",
    "ui.surface": "#FFFFFF",
    "ui.surfaceElevated": "#FFFFFF",
    "ui.surfaceInset": "#F0F0F2",
    "ui.surfaceHover": "#EEEEF0",
    "ui.surfacePressed": "#E2E2E6",
    "ui.borderSubtle": "#E3E3E7",
    "ui.borderStrong": "#87878F",
    "ui.textPrimary": "#19191D",
    "ui.textSecondary": "#5E5E68",
    "ui.textMuted": "#6D6D77",
    "ui.textDisabled": "#9898A1",
    "ui.primaryFill": "#202024",
    "ui.primaryText": "#FFFFFF",
    "ui.selectedFill": "#E6E6EB",
    "ui.focusRing": "#16161A",
    "ui.scrim": "#00000047",
    "ui.shadow": "#00000014",
    "document.paper": "#FFFFFF",
    "document.labelDefault": "#000000",
  },
  dark: {
    "ui.background": "#18181A",
    "ui.workspace": "#242427",
    "ui.surface": "#222225",
    "ui.surfaceElevated": "#2C2C30",
    "ui.surfaceInset": "#19191C",
    "ui.surfaceHover": "#353539",
    "ui.surfacePressed": "#414146",
    "ui.borderSubtle": "#39393F",
    "ui.borderStrong": "#8C8C96",
    "ui.textPrimary": "#F5F5F7",
    "ui.textSecondary": "#B9B9C2",
    "ui.textMuted": "#A0A0AB",
    "ui.textDisabled": "#74747E",
    "ui.primaryFill": "#F1F1F4",
    "ui.primaryText": "#1B1B1F",
    "ui.selectedFill": "#3D3D45",
    "ui.focusRing": "#FFFFFF",
    "ui.scrim": "#00000070",
    "ui.shadow": "#00000040",
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
