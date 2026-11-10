import { DOMParser } from "@xmldom/xmldom";
import { SvgImportError } from "./errors.js";

export function nodes(list: NodeList): Node[] {
  const result: Node[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const node = list.item(index);
    if (node) result.push(node);
  }
  return result;
}

export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

export function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

export function localName(element: Element): string {
  const name = element.localName || element.nodeName;
  const index = name.indexOf(":");
  return index >= 0 ? name.slice(index + 1) : name;
}

export function attributeList(element: Element): Attr[] {
  const list: Attr[] = [];
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attr = element.attributes.item(index);
    if (attr) list.push(attr);
  }
  return list;
}

export function elementChildren(element: Element): Element[] {
  const list: Element[] = [];
  for (const child of nodes(element.childNodes)) {
    if (child.nodeType === 1) list.push(child as Element);
  }
  return list;
}

export function descendants(element: Element): Element[] {
  const list: Element[] = [];
  for (const child of elementChildren(element)) {
    list.push(child);
    list.push(...descendants(child));
  }
  return list;
}

export function parentElement(element: Element): Element | null {
  const parent = element.parentNode;
  if (parent && parent.nodeType === 1) return parent as Element;
  return null;
}

export function findById(root: Element, id: string): Element | null {
  if (root.getAttribute("id") === id) return root;
  for (const element of descendants(root)) {
    if (element.getAttribute("id") === id) return element;
  }
  return null;
}

const PRESERVE_TEXT = new Set(["text", "tspan", "title", "desc", "style"]);

export function serializeElement(element: Element, includeXmlns: boolean): string {
  const name = localName(element);
  const attrs: string[] = [];
  for (const attr of attributeList(element)) {
    if (!includeXmlns && (attr.name === "xmlns" || attr.name.startsWith("xmlns:"))) continue;
    attrs.push(`${attr.name}="${escapeAttr(attr.value)}"`);
  }
  const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  const inner: string[] = [];
  for (const child of nodes(element.childNodes)) {
    if (child.nodeType === 1) {
      inner.push(serializeElement(child as Element, false));
    } else if (child.nodeType === 3 || child.nodeType === 4) {
      const value = child.nodeValue ?? "";
      if (!PRESERVE_TEXT.has(name) && value.trim() === "") continue;
      inner.push(escapeText(value));
    }
  }
  if (inner.length === 0) return `<${name}${attrText}/>`;
  return `<${name}${attrText}>${inner.join("")}</${name}>`;
}

export function prepareSvgText(input: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  let text = input.replace(/^\uFEFF/u, "");
  if (text.includes("\0")) throw new SvgImportError("SVG source contains NUL bytes");
  if (/<!ENTITY/iu.test(text)) throw new SvgImportError("internal entity");
  const encoding = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/iu.exec(text);
  if (encoding?.[1] && encoding[1].toLowerCase() !== "utf-8") {
    throw new SvgImportError("SVG encoding is not UTF-8");
  }
  if (/<\?xml-stylesheet/iu.test(text)) throw new SvgImportError("external stylesheet");
  const doctype = /<!DOCTYPE[\s\S]*?>/iu.exec(text);
  if (doctype) {
    const block = doctype[0];
    if (block.includes("[") || /ENTITY/iu.test(block)) {
      throw new SvgImportError("DOCTYPE internal subset");
    }
    if (!/^<!DOCTYPE\s+svg\b/iu.test(block)) throw new SvgImportError("non-SVG DOCTYPE");
    text = text.replace(block, "");
    notes.push("stripped a standard SVG DOCTYPE");
  }
  return { text, notes };
}

export function parseSvgDocument(text: string): Document {
  const parser = new DOMParser({
    locator: false,
    onError: (level, message) => {
      if (level === "warning") return;
      throw new Error(message);
    },
  });
  let document: Document;
  try {
    document = parser.parseFromString(text, "image/svg+xml") as unknown as Document;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parser error";
    throw new SvgImportError(`SVG could not be parsed: ${message}`);
  }
  const root = document.documentElement;
  if (!root || localName(root) !== "svg") throw new SvgImportError("root element is not svg");
  return document;
}
