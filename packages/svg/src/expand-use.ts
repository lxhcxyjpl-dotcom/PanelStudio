import { SvgImportError } from "./errors.js";
import { formatSvgNumber, roundSvgNumber } from "./number.js";
import { attributeList, descendants, findById, localName, SVG_NS } from "./xml.js";

const PRESENTATION = new Set([
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
  "clip-path",
  "clip-rule",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "display",
  "visibility",
  "color",
]);

export function expandUses(root: Element): boolean {
  let expanded = false;
  const counter = { n: 0 };
  for (let guard = 0; guard < 10_000; guard += 1) {
    const uses = descendants(root).filter((element) => localName(element) === "use");
    if (uses.length === 0) return expanded;
    const leaf =
      uses.find((element) => !descendants(element).some((child) => localName(child) === "use")) ??
      uses[0];
    if (!leaf) return expanded;
    expandUse(leaf, counter, []);
    expanded = true;
  }
  throw new SvgImportError("use expansion did not finish");
}

function expandUse(useElement: Element, counter: { n: number }, stack: string[]): void {
  const href = hashId(useElement.getAttribute("href") ?? useElement.getAttribute("xlink:href"));
  if (!href) throw new SvgImportError("use is missing an internal reference");
  if (stack.includes(href)) throw new SvgImportError("circular use reference");
  const root = useElement.ownerDocument?.documentElement;
  if (!root) throw new SvgImportError("use target could not be expanded");
  if (root.getAttribute("id") === href) throw new SvgImportError("use of the root svg cannot be expanded");
  const target = findById(root, href);
  if (!target || target === useElement) throw new SvgImportError("unresolved use reference");
  for (const inner of descendants(target)) {
    if (localName(inner) === "use") expandUse(inner, counter, [...stack, href]);
  }
  const fresh = findById(root, href);
  if (!fresh) throw new SvgImportError("unresolved use reference");
  const document = useElement.ownerDocument;
  if (!document) throw new SvgImportError("use target could not be expanded");
  const clone = fresh.cloneNode(true) as Element;
  rewriteCloneIds(clone, counter);
  const wrapper = document.createElementNS(SVG_NS, "g");
  const transform = useElement.getAttribute("transform");
  if (transform) wrapper.setAttribute("transform", transform);
  for (const attr of attributeList(useElement)) {
    if (PRESENTATION.has(attr.name)) wrapper.setAttribute(attr.name, attr.value);
  }
  const x = plainLength(useElement.getAttribute("x"));
  const y = plainLength(useElement.getAttribute("y"));
  const holder = document.createElementNS(SVG_NS, "g");
  if (x !== 0 || y !== 0) {
    holder.setAttribute("transform", `translate(${formatSvgNumber(x)} ${formatSvgNumber(y)})`);
  }
  if (localName(fresh) === "symbol" || localName(fresh) === "svg") {
    appendSymbol(holder, clone, useElement);
  } else {
    holder.appendChild(clone);
  }
  wrapper.appendChild(holder);
  const parent = useElement.parentNode;
  if (!parent) throw new SvgImportError("use target could not be expanded");
  parent.replaceChild(wrapper, useElement);
}

function appendSymbol(holder: Element, clone: Element, useElement: Element): void {
  const width = plainLength(useElement.getAttribute("width"));
  const height = plainLength(useElement.getAttribute("height"));
  if (!(width > 0) || !(height > 0)) {
    throw new SvgImportError("use of symbol without a viewport cannot be expanded");
  }
  const viewBox = parseBox(clone.getAttribute("viewBox")) ?? { minX: 0, minY: 0, width, height };
  const sx = width / viewBox.width;
  const sy = height / viewBox.height;
  const s = Math.min(sx, sy);
  const tx = (width - viewBox.width * s) / 2 - viewBox.minX * s;
  const ty = (height - viewBox.height * s) / 2 - viewBox.minY * s;
  const fitted = clone.ownerDocument?.createElementNS(SVG_NS, "g");
  if (!fitted) throw new SvgImportError("use of symbol without a viewport cannot be expanded");
  fitted.setAttribute(
    "transform",
    `translate(${formatSvgNumber(tx)} ${formatSvgNumber(ty)}) scale(${formatSvgNumber(s)})`,
  );
  while (clone.firstChild) fitted.appendChild(clone.firstChild);
  holder.appendChild(fitted);
}

function rewriteCloneIds(clone: Element, counter: { n: number }): void {
  const map = new Map<string, string>();
  const elements = [clone, ...descendants(clone)];
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (!id) continue;
    counter.n += 1;
    const next = `use${counter.n}-${id.replace(/[^A-Za-z0-9._:-]/gu, "_")}`;
    map.set(id, next);
    element.setAttribute("id", next);
  }
  if (map.size === 0) return;
  for (const element of elements) {
    for (const attr of attributeList(element)) {
      const rewritten = rewriteRefs(attr.value, map);
      if (rewritten !== attr.value) element.setAttribute(attr.name, rewritten);
    }
  }
}

function rewriteRefs(value: string, map: Map<string, string>): string {
  const withUrls = value.replace(
    /url\(\s*(['"])#([^)'"]+)\1\s*\)|url\(\s*#([^)'"]+)\s*\)/gu,
    (match, quote: string | undefined, id1: string | undefined, id2: string | undefined) => {
      const id = id1 ?? id2;
      const next = id ? map.get(id) : undefined;
      if (!next) return match;
      return quote ? `url(${quote}#${next}${quote})` : `url(#${next})`;
    },
  );
  const trimmed = withUrls.trim();
  if (trimmed.startsWith("#")) {
    const next = map.get(trimmed.slice(1));
    if (next) return `#${next}`;
  }
  return withUrls;
}

function hashId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("#") || trimmed.length < 2) return null;
  return trimmed.slice(1);
}

function plainLength(value: string | null): number {
  if (value === null || value.trim() === "") return 0;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/u.exec(value.trim());
  if (!match?.[1]) throw new SvgImportError("unsupported length on use");
  const number = Number(match[1]);
  if (!Number.isFinite(number)) throw new SvgImportError("unsupported length on use");
  return roundSvgNumber(number);
}

function parseBox(
  value: string | null,
): { minX: number; minY: number; width: number; height: number } | null {
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
