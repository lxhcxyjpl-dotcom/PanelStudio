import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { fontBundle, fontList, missingGlyphs } from "./fonts.js";
import { rasterizeSvg } from "./raster.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("bundled fonts", () => {
  it("covers Latin and Greek in Noto Sans, and GB2312 text in Noto Sans SC", () => {
    expect(missingGlyphs("Noto Sans", 400, "AΩμ")).toEqual([]);
    expect(missingGlyphs("Noto Sans", 700, "中")).toEqual(["中"]);
    expect(missingGlyphs("Noto Sans SC", 400, "中图α")).toEqual([]);
    expect(missingGlyphs("Noto Sans SC", 700, "㐀")).toEqual(["㐀"]);
    expect(missingGlyphs("Helvetica", 400, "A")).toEqual([]);
  });

  it("lists both families and packs the OFL texts with the font files", () => {
    expect(fontList().fonts.map((font) => font.family)).toEqual(["Noto Sans", "Noto Sans SC"]);
    const zip = fontBundle().bytes;
    expect(zip.subarray(0, 2).toString("latin1")).toBe("PK");
    const entries = unzipSync(zip);
    expect(Buffer.from(entries["OFL-NotoSans.txt"] ?? []).toString("utf8")).toContain("SIL OPEN FONT LICENSE");
    expect(Buffer.from(entries["OFL-NotoSansSC.txt"] ?? []).toString("utf8")).toContain("Reserved Font Name 'Source'");
    expect(Buffer.from(entries["NotoSans-Bold.ttf"] ?? []).subarray(0, 4).toString("latin1")).toBe("\x00\x01\x00\x00");
    expect(entries["NotoSansSC-Regular.ttf"]?.byteLength).toBeGreaterThan(1000);
    const license = readFileSync(path.join(root, "fonts/OFL-NotoSans.txt"), "utf8");
    expect(license).toContain("SIL OPEN FONT LICENSE");
  });

  it("paints Noto Sans into PNG previews and keeps regular and bold distinct", async () => {
    const svg = (weight: number) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80" viewBox="0 0 180 80">
  <rect width="180" height="80" fill="#FFFFFF"/>
  <text x="8" y="56" font-family="Noto Sans" font-size="48" font-weight="${weight}" fill="#000000">Ag</text>
</svg>`;
    const regular = rasterizeSvg(svg(400), 180);
    const bold = rasterizeSvg(svg(700), 180);
    expect(regular.subarray(0, 4).toString("hex")).toBe("89504e47");
    expect((await sharp(regular).stats()).channels[0]?.min).toBeLessThan(250);
    expect(Buffer.compare(regular, bold)).not.toBe(0);
    const chinese = rasterizeSvg(
      `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><text x="8" y="56" font-family="Noto Sans SC" font-size="48" font-weight="700" fill="#000000">图</text></svg>`,
      80,
    );
    expect((await sharp(chinese).stats()).channels[0]?.min).toBeLessThan(250);
  });
});
