import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interaction } from "./interaction.js";
import { metrics } from "./metrics.js";
import { motion } from "./motion.js";
import { renderThemeCss, themeTokens } from "./theme.js";
import { uiFontFamily, uiType } from "./typography.js";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "tokens.css");

describe("theme tokens", () => {
  it("matches the handbook hex values", () => {
    expect(themeTokens.light["ui.background"]).toBe("#F5F5F7");
    expect(themeTokens.dark["ui.background"]).toBe("#18181A");
    expect(themeTokens.light["ui.workspace"]).toBe("#E8E8EB");
    expect(themeTokens.dark["ui.workspace"]).toBe("#242427");
    expect(themeTokens.light["ui.surface"]).toBe("#FFFFFF");
    expect(themeTokens.dark["ui.surface"]).toBe("#222225");
    expect(themeTokens.light["ui.surfaceElevated"]).toBe("#FFFFFF");
    expect(themeTokens.dark["ui.surfaceElevated"]).toBe("#2C2C30");
    expect(themeTokens.light["ui.surfaceInset"]).toBe("#F0F0F2");
    expect(themeTokens.dark["ui.surfaceInset"]).toBe("#19191C");
    expect(themeTokens.light["ui.surfaceHover"]).toBe("#EEEEF0");
    expect(themeTokens.dark["ui.surfaceHover"]).toBe("#353539");
    expect(themeTokens.light["ui.surfacePressed"]).toBe("#E2E2E6");
    expect(themeTokens.dark["ui.surfacePressed"]).toBe("#414146");
    expect(themeTokens.light["ui.borderSubtle"]).toBe("#E3E3E7");
    expect(themeTokens.dark["ui.borderSubtle"]).toBe("#39393F");
    expect(themeTokens.light["ui.borderStrong"]).toBe("#87878F");
    expect(themeTokens.dark["ui.borderStrong"]).toBe("#8C8C96");
    expect(themeTokens.light["ui.textPrimary"]).toBe("#19191D");
    expect(themeTokens.dark["ui.textPrimary"]).toBe("#F5F5F7");
    expect(themeTokens.light["ui.textSecondary"]).toBe("#5E5E68");
    expect(themeTokens.dark["ui.textSecondary"]).toBe("#B9B9C2");
    expect(themeTokens.light["ui.textMuted"]).toBe("#6D6D77");
    expect(themeTokens.dark["ui.textMuted"]).toBe("#A0A0AB");
    expect(themeTokens.light["ui.textDisabled"]).toBe("#9898A1");
    expect(themeTokens.dark["ui.textDisabled"]).toBe("#74747E");
    expect(themeTokens.light["ui.primaryFill"]).toBe("#202024");
    expect(themeTokens.dark["ui.primaryFill"]).toBe("#F1F1F4");
    expect(themeTokens.light["ui.primaryText"]).toBe("#FFFFFF");
    expect(themeTokens.dark["ui.primaryText"]).toBe("#1B1B1F");
    expect(themeTokens.light["ui.selectedFill"]).toBe("#E6E6EB");
    expect(themeTokens.dark["ui.selectedFill"]).toBe("#3D3D45");
    expect(themeTokens.light["ui.focusRing"]).toBe("#16161A");
    expect(themeTokens.dark["ui.focusRing"]).toBe("#FFFFFF");
    expect(themeTokens.light["ui.scrim"]).toBe("#00000047");
    expect(themeTokens.dark["ui.scrim"]).toBe("#00000070");
    expect(themeTokens.light["ui.shadow"]).toBe("#00000014");
    expect(themeTokens.dark["ui.shadow"]).toBe("#00000040");
    expect(themeTokens.light["document.paper"]).toBe("#FFFFFF");
    expect(themeTokens.dark["document.paper"]).toBe("#FFFFFF");
    expect(themeTokens.light["document.labelDefault"]).toBe("#000000");
    expect(themeTokens.dark["document.labelDefault"]).toBe("#000000");
    expect(Object.keys(themeTokens.light)).toEqual(Object.keys(themeTokens.dark));
  });

  it("writes the same custom properties the stylesheet ships", () => {
    const rendered = renderThemeCss();
    if (process.env.WRITE_TOKENS === "1") writeFileSync(cssPath, rendered);
    expect(readFileSync(cssPath, "utf8")).toBe(rendered);
    expect(rendered).toContain("--ui-background: #F5F5F7;");
    expect(rendered).toContain("--ui-surfaceElevated: #2C2C30;");
    expect(rendered).toContain("--document-labelDefault: #000000;");
  });
});

describe("design metrics", () => {
  it("keeps the handbook sizes, type, and motion", () => {
    expect(metrics.designReferencePx).toEqual({ width: 1440, height: 900 });
    expect(metrics.topBarHeightPx).toBe(56);
    expect(metrics.leftSidebarPx).toEqual({ default: 240, min: 208, max: 320 });
    expect(metrics.rightSidebarPx).toEqual({ default: 304, min: 280, max: 360 });
    expect(metrics.radiusPx).toEqual({ input: 7, button: 8, menu: 12, dialog: 16 });
    expect(motion.easing).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(motion.durationMs.buttonPress).toBe(70);
    expect(motion.buttonPressScale).toBe(0.985);
    expect(motion.reducedMotion.maxOpacityDurationMs).toBe(80);
    expect(uiType.control).toEqual({ fontSizePx: 13, lineHeightPx: 20, fontWeight: 400 });
    expect(uiFontFamily).toContain("Noto Sans SC");
    expect(interaction.snapTolerancePx).toBe(6);
    expect(interaction.zoom).toEqual({ min: 0.1, max: 4 });
    expect(interaction.cropOutsideOpacity).toBe(0.25);
  });
});
