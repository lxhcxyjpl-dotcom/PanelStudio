import { uiFontSizes } from "./typography.js";

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
  "brand.paper",
  "brand.accent",
  "ui.warning",
  "ui.danger",
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];

type ThemeColors = Record<ThemeTokenName, string>;

export const themeTokens = {
  light: {
    "ui.background": "#F7F7F5",
    "ui.workspace": "#EEEEEC",
    "ui.surface": "#FFFFFF",
    "ui.surfaceElevated": "#FFFFFF",
    "ui.surfaceInset": "#F5F5F3",
    "ui.surfaceHover": "#F0F0ED",
    "ui.surfacePressed": "#E5E5E1",
    "ui.borderSubtle": "#DDDDDA",
    "ui.borderStrong": "#858580",
    "ui.textPrimary": "#252525",
    "ui.textSecondary": "#565653",
    "ui.textMuted": "#666666",
    "ui.textDisabled": "#999995",
    "ui.primaryFill": "#252525",
    "ui.primaryText": "#FFFFFF",
    "ui.selectedFill": "#F4E9E2",
    "ui.focusRing": "#9B4F35",
    "ui.accent": "#9B4F35",
    "ui.accentSoft": "#F4E9E2",
    "ui.success": "#456B52",
    "ui.scrim": "#11111159",
    "ui.shadow": "#00000014",
    "document.paper": "#FFFFFF",
    "document.labelDefault": "#000000",
    "brand.paper": "#F7F7F5",
    "brand.accent": "#C47755",
    "ui.warning": "#805D19",
    "ui.danger": "#A53932",
  },
  dark: {
    "ui.background": "#1C1C1B",
    "ui.workspace": "#191919",
    "ui.surface": "#242423",
    "ui.surfaceElevated": "#2C2C2A",
    "ui.surfaceInset": "#20201F",
    "ui.surfaceHover": "#323230",
    "ui.surfacePressed": "#3B3B38",
    "ui.borderSubtle": "#3D3D39",
    "ui.borderStrong": "#8E8E87",
    "ui.textPrimary": "#F1F1ED",
    "ui.textSecondary": "#CBCBC5",
    "ui.textMuted": "#AEAEAA",
    "ui.textDisabled": "#787874",
    "ui.primaryFill": "#F1F1ED",
    "ui.primaryText": "#20201F",
    "ui.selectedFill": "#403028",
    "ui.focusRing": "#E0A087",
    "ui.accent": "#E0A087",
    "ui.accentSoft": "#403028",
    "ui.success": "#A0C2A7",
    "ui.scrim": "#00000080",
    "ui.shadow": "#0000003D",
    "document.paper": "#FFFFFF",
    "document.labelDefault": "#000000",
    "brand.paper": "#1C1C1B",
    "brand.accent": "#D69274",
    "ui.warning": "#E1C17C",
    "ui.danger": "#F2A59E",
  },
} as const satisfies { light: ThemeColors; dark: ThemeColors };

export function themeCustomProperty(token: ThemeTokenName): string {
  return `--${token.replaceAll(".", "-")}`;
}

export function renderThemeCss(): string {
  // Root-relative sizes follow the reader's browser font preference in both themes.
  const sizes = Object.entries(uiFontSizes).map(([role, px]) => `  --ui-type-${role}: ${px / 16}rem;`);
  const block = (selector: string, theme: keyof typeof themeTokens) => {
    const declarations = (Object.keys(themeTokens.light) as ThemeTokenName[]).map(
      (token) => `  ${themeCustomProperty(token)}: ${themeTokens[theme][token]};`,
    );
    return `${selector} {\n  color-scheme: ${theme};\n${declarations.join("\n")}\n}`;
  };
  return `:root {\n${sizes.join("\n")}\n}\n\n${block(':root,\n:root[data-theme="light"]', "light")}\n\n${block(':root[data-theme="dark"]', "dark")}\n`;
}
