import { SvgImportError } from "./errors.js";
import { applyStyleProperty } from "./support.js";
import { descendants, localName, parentElement } from "./xml.js";

type Declaration = { name: string; value: string; important: boolean };
type Step = {
  combinator: "desc" | "child";
  element?: string;
  id?: string;
  classes: string[];
  universal?: boolean;
};
type Rule = { steps: Step[][]; declarations: Declaration[]; order: number };

export function inlineStyles(root: Element, sheets: string[]): string[] {
  const notes: string[] = [];
  const rules: Rule[] = [];
  let order = 0;
  for (const sheet of sheets) {
    const parsed = parseStyleSheet(sheet, notes);
    for (const rule of parsed) {
      rules.push({ ...rule, order });
      order += 1;
    }
  }
  const planned = [root, ...descendants(root)].map((element) => ({
    element,
    declarations: matchingDeclarations(element, rules),
  }));
  for (const item of planned) applyDeclarations(item.element, item.declarations);
  return notes;
}

function parseStyleSheet(css: string, notes: string[]): Array<Omit<Rule, "order">> {
  if (/expression\s*\(|javascript:|@import|behavior\s*:/iu.test(css)) {
    throw new SvgImportError("stylesheet contains an external or script-like rule");
  }
  let text = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  text = text.replace(/@font-face\s*\{[^}]*\}/giu, () => {
    notes.push("dropped @font-face");
    return "";
  });
  if (/@[a-z-]+/iu.test(text)) throw new SvgImportError("unsupported CSS at-rule");
  const rules: Array<Omit<Rule, "order">> = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of text.matchAll(rulePattern)) {
    const body = match[2] ?? "";
    const selectors = (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    const steps = selectors.map(parseSelector);
    rules.push({ steps, declarations: parseDeclarations(body) });
  }
  const leftover = text.replace(/([^{}]+)\{([^{}]*)\}/gu, "").trim();
  if (leftover.length > 0) throw new SvgImportError("stylesheet could not be parsed");
  return rules;
}

function parseDeclarations(body: string): Declaration[] {
  return body
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const index = part.indexOf(":");
      if (index <= 0) throw new SvgImportError("invalid style declaration");
      const name = part.slice(0, index).trim().toLowerCase();
      let value = part.slice(index + 1).trim();
      const important = /!important/iu.test(value);
      value = value.replace(/!important/giu, "").trim();
      if (name.length === 0 || value.length === 0) throw new SvgImportError("invalid style declaration");
      return { name, value, important };
    });
}

function parseSelector(selector: string): Step[] {
  const raw = selector.trim().replace(/\s*>\s*/gu, " > ").replace(/\s+/gu, " ");
  const tokens = raw.split(" ").filter((token) => token.length > 0);
  const steps: Step[] = [];
  let combinator: Step["combinator"] = "desc";
  for (const token of tokens) {
    if (token === ">") {
      combinator = "child";
      continue;
    }
    const simple = parseSimple(token);
    steps.push({ ...simple, combinator });
    combinator = "desc";
  }
  if (steps.length === 0) throw new SvgImportError("unsupported CSS selector");
  return steps;
}

function parseSimple(token: string): Omit<Step, "combinator"> {
  if (token === "*") return { classes: [], universal: true };
  let rest = token;
  let element: string | undefined;
  if (!token.startsWith(".") && !token.startsWith("#")) {
    const elementMatch = /^([A-Za-z][\w-]*)/u.exec(rest);
    if (!elementMatch?.[1]) throw new SvgImportError(`unsupported CSS selector ${token}`);
    element = elementMatch[1];
    rest = rest.slice(elementMatch[0].length);
  }
  const classes: string[] = [];
  let id: string | undefined;
  while (rest.length > 0) {
    const classMatch = /^\.([A-Za-z_][\w.-]*)/u.exec(rest);
    if (classMatch?.[1]) {
      classes.push(classMatch[1]);
      rest = rest.slice(classMatch[0].length);
      continue;
    }
    const idMatch = /^#([A-Za-z_][\w.-]*)/u.exec(rest);
    if (idMatch?.[1]) {
      if (id) throw new SvgImportError(`unsupported CSS selector ${token}`);
      id = idMatch[1];
      rest = rest.slice(idMatch[0].length);
      continue;
    }
    throw new SvgImportError(`unsupported CSS selector ${token}`);
  }
  if (!element && !id && classes.length === 0) throw new SvgImportError(`unsupported CSS selector ${token}`);
  return { element, id, classes };
}

function matchingDeclarations(
  element: Element,
  rules: Rule[],
): Array<Declaration & { specificity: number; order: number }> {
  const matched: Array<Declaration & { specificity: number; order: number }> = [];
  for (const rule of rules) {
    for (const steps of rule.steps) {
      if (!matches(element, steps)) continue;
      const specificity = steps.reduce((sum, step) => sum + specificityOf(step), 0);
      for (const declaration of rule.declarations) {
        matched.push({ ...declaration, specificity, order: rule.order });
      }
    }
  }
  matched.sort((left, right) => {
    if (left.important !== right.important) return left.important ? 1 : -1;
    if (left.specificity !== right.specificity) return left.specificity - right.specificity;
    return left.order - right.order;
  });
  return matched;
}

function applyDeclarations(
  element: Element,
  matched: Array<Declaration & { specificity: number; order: number }>,
): void {
  for (const declaration of matched) applyStyleProperty(element, declaration.name, declaration.value);
  const style = element.getAttribute("style");
  if (style !== null) {
    const declarations = parseDeclarations(style);
    const ordered = [
      ...declarations.filter((declaration) => !declaration.important),
      ...declarations.filter((declaration) => declaration.important),
    ];
    for (const declaration of ordered) applyStyleProperty(element, declaration.name, declaration.value);
    element.removeAttribute("style");
  }
  element.removeAttribute("class");
}

function matches(element: Element, steps: Step[]): boolean {
  let current: Element | null = element;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step || !current) return false;
    if (index === steps.length - 1) {
      if (!stepMatches(current, step)) return false;
      continue;
    }
    const combinator = steps[index + 1]?.combinator ?? "desc";
    if (combinator === "child") {
      const parent = parentElement(current);
      if (!parent || !stepMatches(parent, step)) return false;
      current = parent;
      continue;
    }
    let parent = parentElement(current);
    let found = false;
    while (parent) {
      if (stepMatches(parent, step)) {
        current = parent;
        found = true;
        break;
      }
      parent = parentElement(parent);
    }
    if (!found) return false;
  }
  return true;
}

function stepMatches(element: Element, step: Step): boolean {
  if (step.element && localName(element) !== step.element) return false;
  if (step.id && element.getAttribute("id") !== step.id) return false;
  if (step.classes.length > 0) {
    const classes = new Set((element.getAttribute("class") ?? "").split(/\s+/u).filter(Boolean));
    if (step.classes.some((name) => !classes.has(name))) return false;
  }
  return true;
}

function specificityOf(step: Step): number {
  return (step.id ? 100 : 0) + step.classes.length * 10 + (step.element ? 1 : 0);
}
