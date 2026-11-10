import { RESOURCE_LIMITS } from "@panelstudio/contracts";
import { SvgImportError } from "./errors.js";
import { attributeList, localName } from "./xml.js";

/** Depth past this is the handbook's "异常深度" for phase 1. */
export const MAX_SVG_DEPTH = 64;

export const SVG_ELEMENT_LIMIT = RESOURCE_LIMITS.maxSvgElements;

const ALLOWED = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "clipPath",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "image",
  "use",
  "style",
  "title",
  "desc",
]);

const KEEP_ATTRIBUTES = new Set([
  "id",
  "transform",
  "d",
  "points",
  "pathLength",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "dx",
  "dy",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "width",
  "height",
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
  "stop-color",
  "stop-opacity",
  "offset",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clip-path",
  "clippathunits",
  "clip-rule",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-variant",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "display",
  "visibility",
  "overflow",
  "color",
  "paint-order",
  "color-interpolation",
  "preserveAspectRatio",
  "viewBox",
  "href",
  "xlink:href",
  "xml:space",
  "xml:lang",
  "lang",
  "xmlns",
  "xmlns:xlink",
  "class",
  "style",
  "type",
  "gradientUnits".toLowerCase(),
]);

const DROP_ATTRIBUTES = new Set([
  "version",
  "baseProfile",
  "contentScriptType",
  "contentStyleType",
  "zoomAndPan",
  "enable-background",
  "pointer-events",
  "cursor",
  "tabindex",
]);

const STYLE_PROPERTIES = new Set([
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
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-stretch",
  "font-variant",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "display",
  "visibility",
  "overflow",
  "color",
  "paint-order",
  "color-interpolation",
  "clip-path",
  "clip-rule",
  "transform",
]);

const DROPPED_PROPERTIES = new Set([
  "pointer-events",
  "cursor",
  "enable-background",
]);

const REJECT_ELEMENTS = new Set([
  "script",
  "foreignObject",
  "filter",
  "mask",
  "pattern",
  "marker",
  "textPath",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "switch",
  "a",
  "iframe",
  "video",
  "audio",
  "canvas",
  "font",
  "font-face",
  "glyph",
  "missing-glyph",
  "color-profile",
  "tref",
  "altGlyph",
  "cursor",
  "view",
  "link",
  "mpath",
]);

export function isAdobeElement(element: Element): boolean {
  const namespace = element.namespaceURI ?? "";
  if (namespace && /adobe\.com/iu.test(namespace)) return true;
  const qualified = element.nodeName;
  const prefix = qualified.includes(":") ? qualified.slice(0, qualified.indexOf(":")) : "";
  if (prefix && /^(?:i|graph|adobe)$/iu.test(prefix)) return true;
  const name = localName(element);
  return name === "pgf" || name === "aipgf";
}

function isAdobeAttribute(attr: Attr): boolean {
  const namespace = attr.namespaceURI ?? "";
  if (namespace && /adobe\.com/iu.test(namespace)) return true;
  return /^(?:i|graph|adobe):/iu.test(attr.name);
}

export function assertSupportedElement(element: Element): void {
  const name = localName(element);
  if (REJECT_ELEMENTS.has(name) || name.startsWith("fe")) {
    throw new SvgImportError(name);
  }
  if (!ALLOWED.has(name)) throw new SvgImportError(name);
  if (name === "style") {
    const href = element.getAttribute("href") ?? element.getAttribute("xlink:href");
    if (href) throw new SvgImportError("external stylesheet");
  }
}

export function inspectAttributes(element: Element, notes: string[]): void {
  if (localName(element) === "image") {
    const href = element.getAttribute("href") ?? element.getAttribute("xlink:href");
    if (!href) throw new SvgImportError("image is missing embedded data");
  }
  for (const attr of [...attributeList(element)]) {
    const rawName = attr.name;
    const name = rawName.toLowerCase();
    if (isAdobeAttribute(attr)) {
      element.removeAttribute(rawName);
      notes.push("removed Adobe private editing data");
      continue;
    }
    if (name.startsWith("on")) throw new SvgImportError(`event attribute ${rawName}`);
    if (
      name === "filter" ||
      name === "mask" ||
      name === "marker" ||
      name === "marker-start" ||
      name === "marker-mid" ||
      name === "marker-end"
    ) {
      if (attr.value.trim() && attr.value.trim() !== "none") throw new SvgImportError(rawName);
      element.removeAttribute(rawName);
      continue;
    }
    if (name === "vector-effect") {
      if (attr.value.trim() && attr.value.trim() !== "none") throw new SvgImportError("vector-effect");
      element.removeAttribute(rawName);
      continue;
    }
    if (
      name === "requiredfeatures" ||
      name === "requiredextensions" ||
      name === "systemlanguage" ||
      name === "externalresourcesrequired"
    ) {
      throw new SvgImportError(rawName);
    }
    if (name.startsWith("data-") || name.startsWith("aria-")) {
      element.removeAttribute(rawName);
      continue;
    }
    if (DROP_ATTRIBUTES.has(rawName) || DROP_ATTRIBUTES.has(name)) {
      element.removeAttribute(rawName);
      continue;
    }
    if (rawName.startsWith("xmlns:") && rawName !== "xmlns:xlink") {
      element.removeAttribute(rawName);
      continue;
    }
    if (!KEEP_ATTRIBUTES.has(rawName) && !KEEP_ATTRIBUTES.has(name) && !rawName.endsWith(":href")) {
      throw new SvgImportError(`attribute ${rawName}`);
    }
    if (name === "transform" || name === "gradienttransform") assertTransform(attr.value);
    if (isHref(rawName)) assertHref(localName(element), attr.value);
    assertInternalUrls(attr.value);
  }
}

export function applyStyleProperty(element: Element, name: string, value: string): void {
  const property = name.toLowerCase();
  if (DROPPED_PROPERTIES.has(property)) return;
  if (!STYLE_PROPERTIES.has(property)) throw new SvgImportError(`style property ${property}`);
  if (/expression\s*\(|javascript:/iu.test(value)) throw new SvgImportError("script-like style");
  assertInternalUrls(value);
  if (property === "transform") assertTransform(value);
  if (property === "clip-path" && value.trim() !== "none" && !/url\(\s*(['"])?#[^)'"]+\1?\s*\)/iu.test(value)) {
    throw new SvgImportError("clip-path");
  }
  element.setAttribute(property, value);
}

function isHref(name: string): boolean {
  return name === "href" || name.endsWith(":href");
}

function assertHref(elementName: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    if (trimmed.length < 2) throw new SvgImportError("empty internal reference");
    return;
  }
  if (elementName === "image" && /^data:image\/(?:png|jpe?g);base64,/iu.test(trimmed)) {
    assertEmbeddedImage(trimmed);
    return;
  }
  throw new SvgImportError("external reference");
}

function assertEmbeddedImage(value: string): void {
  const match = /^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/iu.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new SvgImportError("embedded image must be a base64 PNG or JPEG");
  const bytes = Buffer.from(match[2].replace(/\s/gu, ""), "base64");
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const kind = match[1].toLowerCase();
  if (kind === "png" && !png) throw new SvgImportError("embedded PNG payload is not a PNG");
  if (kind !== "png" && !jpeg) throw new SvgImportError("embedded JPEG payload is not a JPEG");
}

function assertInternalUrls(value: string): void {
  const pattern = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/giu;
  for (const match of value.matchAll(pattern)) {
    const target = match[2]?.trim() ?? "";
    if (target.startsWith("#")) continue;
    throw new SvgImportError("external URL");
  }
}

export function assertTransform(value: string): void {
  if (/url\(|\bref\s*\(/iu.test(value)) throw new SvgImportError("unsupported transform");
  const tokens = value.trim().match(/(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([^)]*\)/gu);
  if (!tokens) throw new SvgImportError("unsupported transform");
  const consumed = tokens.join("").replace(/\s/gu, "");
  if (consumed !== value.replace(/\s/gu, "")) throw new SvgImportError("unsupported transform");
}

export function referenceIds(value: string, attributeName = ""): string[] {
  const ids: string[] = [];
  const pattern = /url\(\s*(['"])#([^)'"]+)\1\s*\)|url\(\s*#([^)'"]+)\s*\)/giu;
  for (const match of value.matchAll(pattern)) {
    const id = match[2] ?? match[3];
    if (id) ids.push(id);
  }
  const name = attributeName.toLowerCase();
  const trimmed = value.trim();
  if ((name === "href" || name.endsWith(":href")) && trimmed.startsWith("#")) ids.push(trimmed.slice(1));
  return ids;
}
