import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontSizePtToSvgUserUnits } from "@panelstudio/contracts";
import { describe, expect, it } from "vitest";
import { compileFigureSvg } from "./compile.js";
import { SvgImportError } from "./errors.js";
import { instantiateSvg } from "./instantiate.js";
import { normalizeSvg } from "./normalize.js";
import { formatSvgNumber } from "./number.js";
import { parseSvgDocument } from "./xml.js";

const PANEL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PANEL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const gradient = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="50" viewBox="0 0 100 50">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000000"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <clipPath id="round">
      <rect id="clip-rect" x="0" y="0" width="80" height="40"/>
    </clipPath>
  </defs>
  <g id="mark" clip-path="url(#round)">
    <rect id="bar" x="5" y="5" width="70" height="30" fill="url(#fade)" stroke="#000000" stroke-width="1"/>
    <path id="curve" d="M10 30 C 20 10, 40 10, 60 30" fill="none" stroke="#333333"/>
    <text id="note" x="12" y="22" font-family="Noto Sans" font-size="8">n=12</text>
  </g>
</svg>`;

describe("SVG normalize", () => {
  it("keeps paths, text, gradients, and clips", () => {
    const normalized = normalizeSvg(gradient);
    expect(normalized.viewport).toEqual({ width: 100, height: 50 });
    expect(normalized.svg).toContain("<path");
    expect(normalized.svg).toContain("<text");
    expect(normalized.svg).toContain("linearGradient");
    expect(normalized.svg).not.toContain("<image");
    expect(normalized.fonts).toEqual([{ family: "Noto Sans", availableForPreview: true, fallbackFamily: null }]);
    expect(normalized.diagnostics).toEqual([]);
  });

  it("warns when imported text uses a family that is not bundled", () => {
    const normalized = normalizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><text font-family="Helvetica" font-size="10">Hi</text></svg>`,
    );
    expect(normalized.fonts[0]).toEqual({ family: "Helvetica", availableForPreview: false, fallbackFamily: "Noto Sans" });
    expect(normalized.diagnostics.map((item) => item.messageKey)).toEqual(["font.notInstalled"]);
    expect(normalized.svg).toContain('font-family="Helvetica"');
  });

  it("rejects script, filters, and external images", () => {
    expect(() => normalizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)).toThrow(
      SvgImportError,
    );
    expect(() =>
      normalizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" filter="url(#f)"/></svg>`),
    ).toThrow(SvgImportError);
    expect(() =>
      normalizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://example.test/a.png"/></svg>`,
      ),
    ).toThrow(SvgImportError);
  });

  it("expands an internal use and bakes a shifted viewBox", () => {
    const normalized = normalizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="40" viewBox="10 20 100 40">
      <defs><path id="wave" d="M0 0 L10 10"/></defs>
      <use xlink:href="#wave" x="5" y="6"/>
    </svg>`);
    expect(normalized.svg).not.toContain("<use");
    expect(normalized.svg).toContain("M0 0 L10 10");
    expect(normalized.svg).toContain("translate(");
    expect(normalized.viewport).toEqual({ width: 100, height: 40 });
  });

  it("inlines a simple stylesheet", () => {
    const normalized = normalizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
      <style>.box { fill: #112233; stroke-linecap: round; }</style>
      <rect class="box" width="10" height="10"/>
    </svg>`);
    expect(normalized.svg).toContain('fill="#112233"');
    expect(normalized.svg).toContain('stroke-linecap="round"');
    expect(normalized.svg).not.toContain("<style");
  });
});

describe("editable SVG compile", () => {
  it("emits live text and namespaces two instances of one asset", () => {
    const normalized = normalizeSvg(gradient);
    const vector = {
      kind: "vector" as const,
      normalizedSvg: normalized.svg,
      x: 10,
      y: 12,
      scale: 0.4,
    };
    const compiled = compileFigureSvg({
      widthMm: 180,
      heightMm: 120,
      revision: 2,
      includeMetadata: false,
      panels: [
        {
          panelId: PANEL_A,
          frame: { x: 10, y: 12, width: 40, height: 20 },
          label: {
            text: "A",
            x: 10,
            y: 8.825,
            fontFamily: "Noto Sans",
            fontSizeUser: fontSizePtToSvgUserUnits(9),
            fontWeight: 700,
            color: "#000000",
          },
          ...vector,
        },
        {
          panelId: PANEL_B,
          frame: { x: 60, y: 12, width: 40, height: 20 },
          label: {
            text: "B",
            x: 60,
            y: 8.825,
            fontFamily: "Noto Sans",
            fontSizeUser: fontSizePtToSvgUserUnits(9),
            fontWeight: 700,
            color: "#000000",
          },
          ...vector,
          x: 60,
        },
      ],
    });
    expect(compiled.svg).toContain('width="180mm"');
    expect(compiled.svg).toContain('height="120mm"');
    expect(compiled.svg).toContain(`font-size="${formatSvgNumber(fontSizePtToSvgUserUnits(9))}"`);
    expect(compiled.svg).toContain(">A</text>");
    expect(compiled.svg).toContain(">B</text>");
    const document = parseSvgDocument(compiled.svg);
    const ids: string[] = [];
    const elements = document.getElementsByTagName("*");
    for (let index = 0; index < elements.length; index += 1) {
      const id = elements.item(index)?.getAttribute("id");
      if (id) ids.push(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.endsWith("--fade"))).toHaveLength(2);
    expect(compiled.svg).not.toContain('id="fade"');
    const contentA = document.getElementById(`panel-${PANEL_A}-content`);
    expect(contentA?.getAttribute("clip-path")).toBe(`url(#panel-${PANEL_A}-crop)`);
    expect(contentA?.getElementsByTagName("image").length).toBe(0);
    expect(contentA?.getElementsByTagName("path").length).toBeGreaterThan(0);
    expect(contentA?.getElementsByTagName("text").length).toBe(1);
    const label = document.getElementById(`panel-${PANEL_A}-label`);
    expect(label?.parentNode).toBe(document.getElementById(`panel-${PANEL_A}`));
    expect(compiled.svg.match(/<image\b/gu)).toBeNull();
    const again = instantiateSvg(normalized.svg, PANEL_A);
    expect(normalized.svg).toContain('id="fade"');
    expect(again).not.toContain('id="fade"');
  });

  it("does not call resvg from the editable compiler", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "compile.ts"), "utf8");
    expect(source.includes("resvg")).toBe(false);
  });
});
