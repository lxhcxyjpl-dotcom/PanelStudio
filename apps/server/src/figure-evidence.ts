import { createRequire } from "node:module";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { parseSvgDocument } from "@panelstudio/svg";
import type { FigureKind, LocalFigureEvidence } from "@panelstudio/contracts";
import { rasterizeSvg } from "./raster.js";

const require = createRequire(import.meta.url);
export const READER_VERSION = "figure-content-1";
const EDGE = 1440;
const LABELS: Partial<Record<FigureKind, RegExp>> = {
  heatmap: /热[图谱]|heat[\s_-]*map/iu,
  microscopy:
    /显微|荧光染色|组织切片|micro(?:scop|graph)|immunofluorescen|fluorescence[\s_-]*(?:image|stain)|histology/iu,
  blot: /免疫印迹|条带|凝胶电泳|western[\s_-]*blot|immunoblot|\bblot\b|gel[\s_-]*electrophoresis/iu,
  embedding: /降维|嵌入图|\bUMAP(?:[_\s.-]*[12])?\b|\bt[\s_-]*sne\b/iu,
  volcano: /火山图|volcano/iu,
  survival: /生存曲线|kaplan[\s_-]*meier|survival[\s_-]*curve/iu,
  box: /箱[线形须]图|box[\s_-]*(?:plot|and[\s_-]*whisker)/iu,
  violin: /小提琴|violin/iu,
  histogram: /直方图|histogram/iu,
  bar: /柱状图|柱形图|条形图|(?:^|[^a-z])bars?(?:$|[^a-z])|bar[\s_-]*(?:chart|plot|graph)/iu,
  scatter: /散点|scatter(?:plot)?/iu,
  line: /折线|趋势图|line[\s_-]*(?:chart|graph|plot)/iu,
  diagram: /流程图|示意图|schematic|flow[\s_-]*chart|workflow/iu,
  table: /表格|(?:^|[^a-z])table(?:$|[^a-z])/iu,
};
export function explicitKinds(text: string) {
  return (Object.entries(LABELS) as [FigureKind, RegExp][]).flatMap(([kind, re]) => {
    const match = re.exec(text);
    return match ? [{ kind, quote: match[0].trim().replace(/^[-_.]+|[-_.]+$/gu, "") }] : [];
  });
}
/** Local clarification is limited to literal and exclusive group labels; semantic interpretation belongs to the visual model. */
export function printedGroupConflict(filename: string, labels: string[]) {
  const filenameWords = filename.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ");
  const groups = [/\bcontrol\b|对照组/iu, /\btreated\b|处理组|治疗组/iu];
  const nameGroups = groups.map((re) => re.exec(filenameWords)?.[0]);
  if (nameGroups.filter(Boolean).length !== 1) return null;
  const index = nameGroups[0] ? 0 : 1;
  if (labels.some((s) => groups[index]!.test(s))) return null;
  const opposite =
    index === 0
      ? /^(?:treated(?: group)? only|only treated(?: group)?|(?:仅|只有)(?:处理组|治疗组))$/iu
      : /^(?:control(?: group)? only|only control(?: group)?|(?:仅|只有)对照组)$/iu;
  const imageQuote = labels.find((s) => opposite.test(s.trim()));
  return imageQuote ? { nameQuote: nameGroups[index]!, imageQuote } : null;
}
export function differentKinds(a: FigureKind, b: FigureKind) {
  if (a === b || [a, b].some((k) => k === "unknown" || k === "composite")) return false;
  const overlap: FigureKind[][] = [
    ["scatter", "embedding"],
    ["scatter", "volcano"],
    ["bar", "histogram"],
    ["line", "survival"],
  ];
  return !overlap.some((group) => group.includes(a) && group.includes(b));
}
function compact(lines: string[]) {
  const unique = new Set<string>();
  for (const raw of lines) {
    const s = raw
      .replace(/[\u0000-\u001f\s]+/gu, " ")
      .trim()
      .slice(0, 180);
    if (s) unique.add(s);
  }
  return [...unique].sort((a, b) => Number(!/[\p{L}]/u.test(a)) - Number(!/[\p{L}]/u.test(b))).slice(0, 48);
}
type Marks = { dots: number; rectangles: number; lines: number; embedded: number };
function svgEvidence(xml: string) {
  const doc = parseSvgDocument(xml),
    text: string[] = [];
  const marks: Marks = { dots: 0, rectangles: 0, lines: 0, embedded: 0 };
  // The caller supplies normalized document content. Definitions, accessibility metadata
  // and invisible text do not constitute labels printed on the artwork.
  const visit = (node: Element) => {
    const tag = node.localName;
    if (
      ["defs", "metadata", "title", "desc", "clipPath", "mask", "style", "symbol"].includes(tag) ||
      node.getAttribute("display") === "none" ||
      node.getAttribute("visibility") === "hidden" ||
      node.getAttribute("opacity") === "0"
    )
      return;
    if (tag === "text" && node.getAttribute("fill") !== "none" && node.getAttribute("fill-opacity") !== "0") {
      // Keep adjacent tspans in reading order without flattening hidden children.
      const collect = (el: Element): string =>
        Array.from(el.childNodes)
          .map((child) => {
            if (child.nodeType === 3 || child.nodeType === 4) return child.nodeValue ?? "";
            if (child.nodeType !== 1) return "";
            const part = child as Element;
            return part.localName === "tspan" &&
              part.getAttribute("display") !== "none" &&
              part.getAttribute("visibility") !== "hidden" &&
              part.getAttribute("opacity") !== "0"
              ? collect(part)
              : "";
          })
          .join("");
      text.push(collect(node));
      return;
    }
    if (tag === "circle" || tag === "ellipse") marks.dots++;
    if (tag === "rect" && node.getAttribute("fill") !== "none") marks.rectangles++;
    if (tag === "polyline") {
      const points = (node.getAttribute("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (
        points.length >= 6 &&
        points.some((v, i) => i >= 2 && i % 2 === 0 && v !== points[i - 2] && points[i + 1] !== points[i - 1])
      )
        marks.lines++;
    }
    if (tag === "image") marks.embedded++;
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes.item(i);
      if (c?.nodeType === 1) visit(c as Element);
    }
  };
  visit(doc.documentElement);
  return { text: compact(text), marks };
}

export type FigureSource = { bytes: Buffer; mediaType: string; width: number; height: number };
export async function readingImage(source: FigureSource, edge = EDGE) {
  if (source.mediaType === "image/svg+xml") {
    return rasterizeSvg(
      source.bytes.toString("utf8"),
      edge,
      source.width >= source.height ? "width" : "height",
    );
  }
  return sharp(source.bytes)
    .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

export class FigureOcr {
  private worker?: Promise<Worker>;
  private async start() {
    // The worker initializes both languages from one directory. Everything is sourced from the installed packages.
    const dir = await mkdtemp(path.join(tmpdir(), "panelstudio-ocr-"));
    let worker: Worker;
    try {
      await Promise.all(
        ["eng", "chi_sim"].map((code) => {
          const filename = code + ".traineddata.gz";
          return copyFile(
            path.join(
              path.dirname(require.resolve("@tesseract.js-data/" + code + "/package.json")),
              "4.0.0_best_int",
              filename,
            ),
            path.join(dir, filename),
          );
        }),
      );
      worker = await createWorker("eng+chi_sim", OEM.LSTM_ONLY, {
        langPath: dir,
        cacheMethod: "none",
        errorHandler: () => {},
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: "300" });
      return worker;
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  }
  async read(png: Buffer): Promise<{ text: string[]; status: LocalFigureEvidence["ocrStatus"] }> {
    this.worker ??= this.start();
    try {
      const worker = await this.worker;
      const foreground = await sharp(png)
        .flatten({ background: "white" })
        .grayscale()
        .normalize()
        .png()
        .toBuffer();
      async function run(image: Buffer) {
        const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
        return (data.blocks ?? []).flatMap((block) =>
          block.paragraphs.flatMap((p) =>
            p.lines
              .filter((l) => l.confidence >= 50)
              .map((l) => l.text.replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, "$1")),
          ),
        );
      }
      const lines = await run(foreground);
      const word = (s: string) => /[\p{L}]{3,}|[\u3400-\u9fff]{2,}/u.test(s);
      const hasWords = lines.some(word);
      if (hasWords && lines.some((s) => /\d/.test(s))) {
        const meta = await sharp(foreground).metadata(),
          width = meta.width!,
          height = meta.height!;
        if (width >= 150 && height >= 120) {
          const band = Math.max(1, Math.round(width * 0.115));
          for (const [left, angle] of [
            [0, 90],
            [width - band, 270],
          ] as const) {
            const strip = await sharp(foreground)
              .extract({ left, top: 0, width: band, height })
              .png()
              .toBuffer();
            lines.push(...(await run(await sharp(strip).rotate(angle).png().toBuffer())).filter(word));
          }
        }
      }
      const text = hasWords
        ? compact(
            lines.filter(
              (s) => word(s) || /^\s*[-+.\d(),%]+\s*$/.test(s) || /^\s*[A-Z][A-Z0-9]{0,4}\s*$/.test(s),
            ),
          )
        : [];
      return { text, status: text.length ? "read" : "empty" };
    } catch {
      return { text: [], status: "unavailable" };
    }
  }
  async close() {
    const worker = await this.worker?.catch(() => undefined);
    if (worker) await worker.terminate();
  }
}

async function pixelCue(png: Buffer): Promise<FigureKind> {
  const { data, info } = await sharp(png)
    .resize(192, 192, { fit: "inside" })
    .flatten({ background: "white" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let dark = 0,
    bright = 0,
    saturated = 0,
    white = 0;
  const tops = Array<number>(info.width).fill(info.height),
    bottoms = Array<number>(info.width).fill(-1);
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]!,
      g = data[i + 1] ?? r,
      b = data[i + 2] ?? r,
      high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    if (high < 50) dark++;
    if (high > 120) bright++;
    if (low > 225) white++;
    if (high - low > 55) saturated++;
    if (high - low > 12 && high < 242) {
      const index = i / info.channels,
        x = index % info.width,
        y = Math.floor(index / info.width);
      tops[x] = Math.min(tops[x]!, y);
      bottoms[x] = Math.max(bottoms[x]!, y);
    }
  }
  const n = info.width * info.height;
  if (dark / n > 0.62 && bright / n > 0.01 && saturated / n > 0.016) return "microscopy";
  if (white / n > 0.65) {
    let run = 0,
      low = Infinity,
      high = -Infinity,
      last = -1;
    for (let x = 0; x < info.width; x++) {
      const top = tops[x]!,
        bottom = bottoms[x]!,
        y = (top + bottom) / 2;
      if (
        bottom < top ||
        bottom - top > Math.max(8, info.height * 0.07) ||
        (last >= 0 && Math.abs(y - last) > info.height * 0.06)
      ) {
        run = 0;
        low = Infinity;
        high = -Infinity;
        last = -1;
        continue;
      }
      run++;
      last = y;
      low = Math.min(low, y);
      high = Math.max(high, y);
      if (run > info.width * 0.48 && high - low > info.height * 0.12) return "line";
    }
  }
  return "unknown";
}
/** Pixel or visible-ink evidence only. The filename is deliberately absent from this interface. */
export async function extractFigureEvidence(
  source: FigureSource,
  ocr: FigureOcr,
  image?: Buffer,
): Promise<LocalFigureEvidence> {
  const svg = source.mediaType === "image/svg+xml" ? svgEvidence(source.bytes.toString("utf8")) : null;
  const svgText = svg?.text ?? [];
  const needOcr = !svgText.some((s) => /\p{L}/u.test(s)) || Boolean(svg?.marks.embedded);
  let ocrText: string[] = [],
    ocrStatus: LocalFigureEvidence["ocrStatus"] = "not-needed";
  if (needOcr) {
    image ??= await readingImage(source);
    const ocrImage = Math.max(source.width, source.height) > EDGE ? await readingImage(source, 2304) : image;
    const result = await ocr.read(ocrImage);
    ocrText = result.text.filter((s) => !svgText.includes(s));
    ocrStatus = result.status;
  }
  const labels = [...svgText, ...ocrText];
  const named = explicitKinds(labels.join(" "));
  const marks = svg?.marks;
  const cues: string[] = [];
  let category: FigureKind = "unknown",
    confidence: LocalFigureEvidence["confidence"] = "low";
  // Axis names and visible marks are supporting hints. Conflicting hints are left to the visual model.
  if (named.length === 1) {
    category = named[0]!.kind;
    confidence = svgText.length || ocrStatus === "read" ? "high" : "medium";
    cues.push(named[0]!.quote);
  } else if (named.length > 1) cues.push(...named.map((n) => n.quote));
  else if (marks && marks.rectangles >= 25 && marks.rectangles > marks.dots * 3) {
    category = "heatmap";
    confidence = "medium";
    cues.push(marks.rectangles + " filled rectangles");
  } else if (marks && marks.lines && marks.dots >= 2 && labels.some((l) => /\p{L}/u.test(l))) {
    category = "line";
    confidence = "high";
    cues.push("connected data points");
  } else if (marks && marks.dots >= 8 && !marks.embedded) {
    category = "scatter";
    confidence = "medium";
    cues.push(marks.dots + " point marks");
  }
  if (category === "unknown" && (needOcr || marks?.embedded)) {
    image ??= await readingImage(source);
    const shape = await pixelCue(image);
    if (shape === "microscopy") {
      category = "microscopy";
      confidence = "medium";
      cues.push("bright colour on a dark field");
    } else if (shape === "line" && labels.some((l) => /\p{L}/u.test(l))) {
      category = "line";
      confidence = labels.filter((l) => /[0-9]/.test(l)).length >= 2 ? "high" : "medium";
      cues.push("long continuous trace on labelled axes");
    }
  }
  return { category, confidence, svgText, ocrText, ocrStatus, cues: cues.slice(0, 8) };
}
