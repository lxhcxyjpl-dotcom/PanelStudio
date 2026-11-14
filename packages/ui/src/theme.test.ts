import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { interaction } from "./interaction.js";
import { metrics } from "./metrics.js";
import { motion } from "./motion.js";
import { renderThemeCss, themeTokens } from "./theme.js";
import { uiFontFamily, uiFontSizes, uiType } from "./typography.js";

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "tokens.css");

describe("theme tokens", () => {
  it("provides matching themes, legible controls and independent artwork colors", () => {
    expect(Object.keys(themeTokens.light)).toEqual(Object.keys(themeTokens.dark));
    for (const theme of Object.values(themeTokens)) {
      expect(theme["document.paper"]).toBe("#FFFFFF");
      expect(theme["document.labelDefault"]).toBe("#000000");
      const luminance = (hex: string) => {
        const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
          .map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
      };
      for (const [text, surface] of [["ui.textPrimary", "ui.surface"], ["ui.textMuted", "ui.surface"],
        ["ui.primaryText","ui.primaryFill"], ["ui.accent","ui.accentSoft"]] as const) {
        const values = [luminance(theme[text]), luminance(theme[surface])];
        expect((Math.max(...values) + .05) / (Math.min(...values) + .05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("writes the same custom properties the stylesheet ships", () => {
    const rendered = renderThemeCss();
    if (process.env.WRITE_TOKENS === "1") writeFileSync(cssPath, rendered);
    expect(readFileSync(cssPath, "utf8")).toBe(rendered);
    expect(rendered).toContain("--ui-background: #F7F7F5;");
    expect(rendered).toContain("--ui-surfaceElevated: #2C2C2A;");
    expect(rendered).toContain("--document-labelDefault: #000000;");
  });
});

describe("design metrics", () => {
  it("keeps the editor sizes, type, and motion", () => {
    expect(metrics.designReferencePx).toEqual({ width: 1440, height: 900 });
    expect(metrics.topBarHeightPx).toBe(60);
    expect(metrics.leftSidebarPx).toEqual({ default: 240, min: 208, max: 320 });
    expect(metrics.rightSidebarPx).toEqual({ default: 352, min: 320, max: 420 });
    expect(metrics.radiusPx).toEqual({ input: 6, button: 6, menu: 8, dialog: 12 });
    expect(motion.easing).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(motion.durationMs.buttonPress).toBe(70);
    expect(motion.buttonPressScale).toBe(0.985);
    expect(motion.reducedMotion.maxOpacityDurationMs).toBe(80);
    expect(Object.values(uiFontSizes)).toEqual([13, 15, 24, 56]);
    expect(uiType.control).toEqual({ fontSizePx: uiFontSizes.body, lineHeightPx: 22, fontWeight: 400 });
    expect(uiFontFamily).toContain("Noto Sans SC");
    expect(interaction.snapTolerancePx).toBe(6);
    expect(interaction.zoom).toEqual({ min: 0.1, max: 4 });
    expect(interaction.cropOutsideOpacity).toBe(0.25);
  });
});
