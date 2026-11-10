import { RESOURCE_LIMITS } from "./constants.js";
import type { LabelFormat, LabelSequence } from "./document.js";

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Unicode code points, not UTF-16 code units and not grapheme clusters. */
export function unicodeLength(value: string): number {
  return [...value].length;
}

export function assertCustomLabelText(text: string): void {
  if (
    text.length === 0 ||
    /[\r\n]/u.test(text) ||
    unicodeLength(text) > RESOURCE_LIMITS.maxCustomLabelCharacters
  ) {
    throw new Error("custom label text must be 1–16 Unicode code points on one line");
  }
}

/**
 * Index 0 is A/a for alpha sequences and 1 for numeric sequences.
 * More than 26 alpha labels is out of range. v0.1 panels stop at 8.
 */
export function labelCore(index: number, sequence: LabelSequence): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error("label index must be a non-negative integer");
  }
  if (sequence === "number") {
    return String(index + 1);
  }
  const letter = ALPHA[index];
  if (letter === undefined) {
    throw new Error("alpha label index is out of range");
  }
  return sequence === "lower-alpha" ? letter.toLowerCase() : letter;
}

/** plain → A, parentheses → (A), dot → A. */
export function formatLabel(core: string, format: LabelFormat): string {
  switch (format) {
    case "plain":
      return core;
    case "parentheses":
      return `(${core})`;
    case "dot":
      return `${core}.`;
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
}

/**
 * 1. Non-null text is used verbatim.
 * 2. Otherwise generate from the panelOrder index and sequence.
 * 3. Then apply format. Custom text is not formatted again.
 */
export function resolveLabelText(input: {
  index: number;
  textOverride: string | null;
  sequence: LabelSequence;
  format: LabelFormat;
}): string {
  if (input.textOverride !== null) {
    assertCustomLabelText(input.textOverride);
    return input.textOverride;
  }
  return formatLabel(labelCore(input.index, input.sequence), input.format);
}
