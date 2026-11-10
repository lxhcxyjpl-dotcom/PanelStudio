import { attributeList, descendants, parseSvgDocument, prepareSvgText, serializeElement } from "./xml.js";

/**
 * Structural ids are `panel-{panelId}-content|label|crop`.
 * Instantiated source ids use a double hyphen so a source id of `content`
 * cannot collide with the content group.
 */
export function instancePrefix(panelId: string): string {
  return `panel-${panelId}--`;
}

export function instantiateSvg(normalizedSvg: string, panelId: string): string {
  const prepared = prepareSvgText(normalizedSvg);
  const document = parseSvgDocument(prepared.text);
  const root = document.documentElement;
  if (!root) throw new Error("normalized SVG has no root");
  const elements = descendants(root);
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const element of elements) {
    const id = element.getAttribute("id");
    if (!id) continue;
    const next = uniqueInstanceId(panelId, id, used);
    map.set(id, next);
    element.setAttribute("id", next);
  }
  for (const element of elements) {
    for (const attr of attributeList(element)) {
      const rewritten = rewriteReferences(attr.value, map);
      if (rewritten !== attr.value) element.setAttribute(attr.name, rewritten);
    }
  }
  return elementChildrenXml(root);
}

function elementChildrenXml(root: Element): string {
  const parts: string[] = [];
  for (let index = 0; index < root.childNodes.length; index += 1) {
    const child = root.childNodes.item(index);
    if (child && child.nodeType === 1) parts.push(serializeElement(child as Element, false));
  }
  return parts.join("");
}

function uniqueInstanceId(panelId: string, sourceId: string, used: Set<string>): string {
  const sanitized = sourceId.replace(/[^A-Za-z0-9._:-]/gu, "_");
  const body = sanitized.length > 0 ? sanitized : "n";
  let next = `${instancePrefix(panelId)}${body}`;
  let suffix = 2;
  while (used.has(next)) {
    next = `${instancePrefix(panelId)}${body}-${suffix}`;
    suffix += 1;
  }
  used.add(next);
  return next;
}

export function rewriteReferences(value: string, map: Map<string, string>): string {
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
