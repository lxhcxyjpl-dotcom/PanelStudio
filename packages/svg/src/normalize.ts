import { BUNDLED_FONTS, NORMALIZATION_VERSION, type Diagnostic, type NormalizedAsset } from "@panelstudio/contracts";
import { inlineStyles } from "./css.js";
import { expandUses } from "./expand-use.js";
import { SvgImportError } from "./errors.js";
import { formatSvgNumber, roundSvgNumber } from "./number.js";
import {
  MAX_SVG_DEPTH,
  SVG_ELEMENT_LIMIT,
  assertSupportedElement,
  inspectAttributes,
  isAdobeElement,
  referenceIds,
} from "./support.js";
import {
  SVG_NS,
  XLINK_NS,
  attributeList,
  descendants,
  elementChildren,
  findById,
  localName,
  nodes,
  parseSvgDocument,
  prepareSvgText,
  serializeElement,
} from "./xml.js";

export type NormalizedSvg = {
  svg: string;
  viewport: { width: number; height: number };
  fonts: NormalizedAsset["fonts"];
  diagnostics: Diagnostic[];
  notes: string[];
};

const INHERITED = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "color",
  "visibility",
  "display",
  "clip-rule",
]);

export function normalizeSvg(source: string): NormalizedSvg {
  const prepared = prepareSvgText(source);
  const document = parseSvgDocument(prepared.text);
  const root = document.documentElement;
  if (!root) throw new SvgImportError("root element is not svg");
  const notes = [...prepared.notes];
  stripNonGraphic(root, notes);
  const sheets: string[] = [];
  let count = 0;
  walk(root, 0, (element) => {
    count += 1;
    if (count > SVG_ELEMENT_LIMIT) throw new SvgImportError("SVG element limit");
    assertSupportedElement(element);
    inspectAttributes(element, notes);
    if (localName(element) === "style") sheets.push(element.textContent ?? "");
  });
  notes.push(...inlineStyles(root, sheets));
  for (const style of descendants(root).filter((element) => localName(element) === "style")) {
    style.parentNode?.removeChild(style);
  }
  if (expandUses(root)) notes.push("expanded internal use references");
  count = 0;
  const ids = new Set<string>();
  walk(root, 0, (element) => {
    count += 1;
    if (count > SVG_ELEMENT_LIMIT) throw new SvgImportError("SVG element limit");
    assertSupportedElement(element);
    if (localName(element) === "use" || localName(element) === "style") {
      throw new SvgImportError(localName(element));
    }
    inspectAttributes(element, notes);
    const id = element.getAttribute("id");
    if (id) {
      if (ids.has(id)) throw new SvgImportError(`duplicate id ${id}`);
      ids.add(id);
    }
  });
  assertResolvedReferences(root);
  const fonts = collectFonts(root);
  const viewport = bakeViewport(document, root, notes);
  const diagnostics: Diagnostic[] = fonts.flatMap((font) =>
    font.availableForPreview
      ? []
      : [
          {
            code: "FONT_MISSING" as const,
            severity: "warning" as const,
            messageKey: "font.notInstalled",
            params: { family: font.family },
          },
        ],
  );
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${serializeElement(root, true)}`;
  return {
    svg,
    viewport,
    fonts,
    diagnostics,
    notes: unique(notes),
  };
}

export function normalizationVersion(): string {
  return NORMALIZATION_VERSION;
}

function stripNonGraphic(element: Element, notes: string[]): void {
  for (const child of nodes(element.childNodes)) {
    if (child.nodeType === 8) {
      element.removeChild(child);
      notes.push("removed comments");
      continue;
    }
    if (child.nodeType === 7 && child.nodeName.toLowerCase() !== "xml") {
      element.removeChild(child);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const node = child as Element;
    if (isAdobeElement(node)) {
      element.removeChild(node);
      notes.push("removed Adobe private editing data");
      continue;
    }
    if (localName(node) === "metadata") {
      element.removeChild(node);
      notes.push("removed metadata");
      continue;
    }
    stripNonGraphic(node, notes);
  }
}

function walk(element: Element, depth: number, visit: (element: Element) => void): void {
  if (depth > MAX_SVG_DEPTH) throw new SvgImportError("SVG element depth exceeds 64");
  visit(element);
  for (const child of elementChildren(element)) walk(child, depth + 1, visit);
}

function assertResolvedReferences(root: Element): void {
  const elements = [root, ...descendants(root)];
  for (const element of elements) {
    for (const attr of attributeList(element)) {
      for (const id of referenceIds(attr.value, attr.name)) {
        if (!id || !findById(root, id)) throw new SvgImportError(`unresolved reference ${id}`);
      }
    }
  }
}

const BUNDLED_FAMILIES = new Set<string>(BUNDLED_FONTS.map((font) => font.family));

function collectFonts(root: Element): NormalizedAsset["fonts"] {
  const families = new Set<string>();
  for (const element of [root, ...descendants(root)]) {
    const value = element.getAttribute("font-family");
    if (!value) continue;
    for (const family of value.split(",")) {
      const name = family.trim().replace(/^['"]|['"]$/gu, "");
      if (name) families.add(name);
    }
  }
  return [...families].map((family) => {
    const bundled = BUNDLED_FAMILIES.has(family);
    return {
      family,
      availableForPreview: bundled,
      fallbackFamily: bundled ? null : "Noto Sans",
    };
  });
}

function bakeViewport(document: Document, root: Element, notes: string[]): { width: number; height: number } {
  const viewBox = parseViewBox(root.getAttribute("viewBox"));
  const width = parseLength(root.getAttribute("width"));
  const height = parseLength(root.getAttribute("height"));
  const par = parsePreserveAspectRatio(root.getAttribute("preserveAspectRatio"));
  let vpW: number | null = width && "px" in width ? width.px : null;
  let vpH: number | null = height && "px" in height ? height.px : null;
  if (vpW === null || vpH === null) {
    if (!viewBox) throw new SvgImportError("SVG viewport is missing");
    vpW = viewBox.width;
    vpH = viewBox.height;
  }
  if (!(vpW > 0) || !(vpH > 0)) throw new SvgImportError("SVG viewport is empty");
  const vb = viewBox ?? { minX: 0, minY: 0, width: vpW, height: vpH };
  const viewport = { width: roundSvgNumber(vpW), height: roundSvgNumber(vpH) };
  const transform = viewBoxTransform(
    {
      minX: roundSvgNumber(vb.minX),
      minY: roundSvgNumber(vb.minY),
      width: roundSvgNumber(vb.width),
      height: roundSvgNumber(vb.height),
    },
    viewport,
    par,
  );
  const inner = document.createElementNS(SVG_NS, "g");
  const rootId = root.getAttribute("id");
  if (rootId) inner.setAttribute("id", rootId);
  for (const attr of attributeList(root)) {
    if (INHERITED.has(attr.name)) inner.setAttribute(attr.name, attr.value);
  }
  if (transform) inner.setAttribute("transform", transform);
  while (root.firstChild) inner.appendChild(root.firstChild);
  const clipId = uniqueId(inner, "normalized-viewport-clip");
  const defs = document.createElementNS(SVG_NS, "defs");
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  clip.setAttribute("clipPathUnits", "userSpaceOnUse");
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", formatSvgNumber(viewport.width));
  rect.setAttribute("height", formatSvgNumber(viewport.height));
  clip.appendChild(rect);
  defs.appendChild(clip);
  const outer = document.createElementNS(SVG_NS, "g");
  outer.setAttribute("clip-path", `url(#${clipId})`);
  outer.appendChild(inner);
  for (const attr of [...attributeList(root)]) root.removeAttribute(attr.name);
  root.setAttribute("xmlns", SVG_NS);
  root.setAttribute("xmlns:xlink", XLINK_NS);
  root.setAttribute("width", formatSvgNumber(viewport.width));
  root.setAttribute("height", formatSvgNumber(viewport.height));
  root.setAttribute("viewBox", `0 0 ${formatSvgNumber(viewport.width)} ${formatSvgNumber(viewport.height)}`);
  root.appendChild(defs);
  root.appendChild(outer);
  notes.push("baked root viewBox and preserveAspectRatio");
  return viewport;
}

function uniqueId(scope: Element, base: string): string {
  const taken = new Set(
    [scope, ...descendants(scope)].map((element) => element.getAttribute("id")).filter((id) => id !== null),
  );
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

type Length = { px: number } | { percent: number };
type ViewBox = { minX: number; minY: number; width: number; height: number };
type Aspect =
  | { align: "none" }
  | { align: "align"; x: number; y: number; fit: "meet" | "slice" };

function parseLength(value: string | null): Length | null {
  if (value === null) return null;
  const text = value.trim();
  if (text.length === 0) return null;
  if (text.endsWith("%")) {
    const percent = Number(text.slice(0, -1));
    if (!Number.isFinite(percent)) throw new SvgImportError("unsupported SVG length");
    return { percent };
  }
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|mm|cm|in|pt|pc)?$/iu.exec(text);
  if (!match?.[1]) throw new SvgImportError("unsupported SVG length");
  const amount = Number(match[1]);
  const unit = (match[2] ?? "px").toLowerCase();
  const factor =
    unit === "in"
      ? 96
      : unit === "mm"
        ? 96 / 25.4
        : unit === "cm"
          ? 96 / 2.54
          : unit === "pt"
            ? 96 / 72
            : unit === "pc"
              ? 16
              : 1;
  return { px: amount * factor };
}

function parseViewBox(value: string | null): ViewBox | null {
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new SvgImportError("invalid viewBox");
  }
  const [minX, minY, width, height] = parts as [number, number, number, number];
  if (!(width > 0) || !(height > 0)) throw new SvgImportError("viewBox size must be positive");
  return { minX, minY, width, height };
}

function parsePreserveAspectRatio(value: string | null): Aspect {
  const text = (value ?? "xMidYMid meet").trim().replace(/^defer\s+/u, "");
  if (text === "none" || text.startsWith("none ")) return { align: "none" };
  const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/u.exec(text);
  if (!match?.[1] || !match[2]) throw new SvgImportError("unsupported preserveAspectRatio");
  const x = match[1] === "xMin" ? 0 : match[1] === "xMax" ? 1 : 0.5;
  const y = match[2] === "YMin" ? 0 : match[2] === "YMax" ? 1 : 0.5;
  const fit = match[3] === "slice" ? "slice" : "meet";
  return { align: "align", x, y, fit };
}

function viewBoxTransform(viewBox: ViewBox, viewport: { width: number; height: number }, aspect: Aspect): string | null {
  if (!(viewBox.width > 0) || !(viewBox.height > 0)) throw new SvgImportError("viewBox size must be positive");
  let tx: number;
  let ty: number;
  let sx: number;
  let sy: number;
  if (aspect.align === "none") {
    sx = viewport.width / viewBox.width;
    sy = viewport.height / viewBox.height;
    tx = -viewBox.minX * sx;
    ty = -viewBox.minY * sy;
  } else {
    const scaleX = viewport.width / viewBox.width;
    const scaleY = viewport.height / viewBox.height;
    const scale = aspect.fit === "slice" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    sx = scale;
    sy = scale;
    tx = (viewport.width - viewBox.width * scale) * aspect.x - viewBox.minX * scale;
    ty = (viewport.height - viewBox.height * scale) * aspect.y - viewBox.minY * scale;
  }
  if (Math.abs(tx) < 1e-9 && Math.abs(ty) < 1e-9 && Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) {
    return null;
  }
  if (Math.abs(sx - sy) < 1e-9) {
    return `translate(${formatSvgNumber(tx)} ${formatSvgNumber(ty)}) scale(${formatSvgNumber(sx)})`;
  }
  return `translate(${formatSvgNumber(tx)} ${formatSvgNumber(ty)}) scale(${formatSvgNumber(sx)} ${formatSvgNumber(sy)})`;
}

function unique(notes: string[]): string[] {
  return [...new Set(notes)];
}
