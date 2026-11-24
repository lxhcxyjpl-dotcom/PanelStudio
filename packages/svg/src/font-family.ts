const genericFamilies = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

export function namedFontFamilies(value: string): string[] {
  return value.split(",").flatMap(family => {
    const token = family.trim();
    if (genericFamilies.has(token.toLowerCase())) return [];
    const name = token.replace(/^['"]|['"]$/gu, "");
    return name ? [name] : [];
  });
}
