const EXACT = new Set(["撤销", "撤消", "undo"]);

/** History actions are not model calls. Matching is the whole prompt, after trim. */
export function isDirectUndo(prompt: string): boolean {
  return EXACT.has(prompt.trim().toLowerCase());
}
