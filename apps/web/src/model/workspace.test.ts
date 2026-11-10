import { createDefaultFigureDocument, REPRESENTATIVE_MESSAGES } from "@panelstudio/contracts";
import { applyCommands } from "@panelstudio/core/apply";
import { describe, expect, it } from "vitest";
import { enUS, messageKeys, zhCN, type MessageKey } from "../i18n/catalog";
import { sidebarWidth, workspaceMode } from "./chrome";
import { placePanelCommands } from "./place";
import { snapTranslation } from "./snap";

const A = "11111111-1111-4111-8111-111111111111";
const B = "11111111-1111-4111-8111-111111111112";
const ASSET_A = "22222222-2222-4222-8222-222222222221";
const ASSET_B = "22222222-2222-4222-8222-222222222222";

describe("phase 4 workspace rules", () => {
  it("uses the handbook column widths at 1440, 1280, and 1024", () => {
    expect(workspaceMode(1440)).toBe("full");
    expect(workspaceMode(1280)).toBe("full");
    expect(workspaceMode(1024)).toBe("compact");
    expect(workspaceMode(1023)).toBe("drawer");
    expect(sidebarWidth("left", "full", 240)).toBe(240);
    expect(sidebarWidth("right", "full", 304)).toBe(304);
    expect(sidebarWidth("left", "compact", 240)).toBe(208);
    expect(sidebarWidth("right", "compact", 304)).toBe(280);
    expect(sidebarWidth("left", "full", 100)).toBe(208);
    expect(sidebarWidth("right", "full", 900)).toBe(360);
  });

  it("keeps the representative copy and falls back through the same keys", () => {
    for (const [key, value] of Object.entries(REPRESENTATIVE_MESSAGES["zh-CN"])) {
      expect(zhCN[key as MessageKey]).toBe(value);
    }
    for (const [key, value] of Object.entries(REPRESENTATIVE_MESSAGES["en-US"])) {
      expect(enUS[key as MessageKey]).toBe(value);
    }
    expect(messageKeys.every((key) => zhCN[key] && enUS[key])).toBe(true);
    expect(JSON.stringify({ zhCN, enUS })).not.toMatch(/<|\{%/);
  });

  it("places imported panels with the shared command applicator", () => {
    const document = createDefaultFigureDocument();
    const commands = placePanelCommands(document, [
      { panelId: A, assetId: ASSET_A, viewport: { width: 80, height: 40 } },
      { panelId: B, assetId: ASSET_B, viewport: { width: 60, height: 40 } },
    ]);
    const next = applyCommands(document, commands, (assetId) => ({
      id: assetId,
      originalFilename: assetId,
      viewport: assetId === ASSET_A ? { width: 80, height: 40 } : { width: 60, height: 40 },
      rasterPixelSize: null,
    }));
    expect(next.panelOrder).toEqual([A, B]);
    expect(next.panels[A]?.frameMm.width).toBeGreaterThan(0);
    expect(next.panels[B]?.frameMm.height).toBeGreaterThan(0);
  });

  it("snaps a move to another panel edge inside six screen pixels", () => {
    const snapped = snapTranslation({
      bounds: { x: 10, y: 12, width: 20, height: 10 },
      dx: 0.2,
      dy: 5,
      canvas: {
        widthMm: 180,
        heightMm: 120,
        marginsMm: { top: 4, right: 4, bottom: 4, left: 4 },
      },
      others: [{ x: 30.1, y: 40, width: 10, height: 10 }],
      toleranceMm: 1,
      enabled: true,
    });
    expect(snapped.dx).toBeCloseTo(0.1);
    expect(snapped.guides.some((guide) => guide.axis === "x")).toBe(true);
    const paused = snapTranslation({ ...{
      bounds: { x: 10, y: 12, width: 20, height: 10 },
      dx: 0.2,
      dy: 0,
      canvas: {
        widthMm: 180,
        heightMm: 120,
        marginsMm: { top: 4, right: 4, bottom: 4, left: 4 },
      },
      others: [{ x: 30.1, y: 40, width: 10, height: 10 }],
      toleranceMm: 1,
      enabled: false,
    } });
    expect(paused.dx).toBe(0.2);
    expect(paused.guides).toEqual([]);
  });
});
