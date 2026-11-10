/** At most 6 decimal places, trailing zeros removed. */
export function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("non-finite SVG number");
  const rounded = Number(value.toFixed(6));
  if (rounded === 0) return "0";
  return rounded.toFixed(6).replace(/\.?0+$/u, "");
}

export function roundSvgNumber(value: number): number {
  return Number(formatSvgNumber(value));
}
