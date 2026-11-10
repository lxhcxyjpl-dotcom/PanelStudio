import type { GuidedPreferences, ReferenceSlot } from "@panelstudio/contracts";
import { compositions, unionRect } from "./measure.js";

export type Axis = "horizontal" | "vertical";
export type Tree = { unit: string } | { axis: Axis; children: Tree[]; weights?: number[] };
const branch = (axis: Axis, children: Tree[], weights?: number[]): Tree =>
  children.length === 1 ? children[0]! : { axis, children, weights };

/** First find separate rows, then columns within each band. Shared headers and legends
 * are deliberately outside the set of reviewed panel regions. */
export function referenceTree(slots: ReferenceSlot[]): Tree | null {
  if (slots.length === 1) return { unit: slots[0]!.unitId };
  for (const axis of ["vertical", "horizontal"] as const) {
    const [position, extent] = axis === "vertical" ? ["y", "height"] as const : ["x", "width"] as const;
    const bands: ReferenceSlot[][] = [];
    let end = -1;
    for (const slot of [...slots].sort((a, b) => a[position] - b[position])) {
      if (!bands.length || slot[position] >= end - 0.002) {
        bands.push([]);
        end = slot[position] + slot[extent];
      } else end = Math.max(end, slot[position] + slot[extent]);
      bands.at(-1)!.push(slot);
    }
    if (bands.length < 2) continue;
    const children = bands.map(referenceTree);
    if (children.every((child): child is Tree => child !== null))
      return branch(axis, children, bands.map((band) => unionRect(band)![extent]));
  }
  return null;
}

function rowOptions(nodes: Tree[]): Tree[] {
  return compositions(nodes.length).map((pattern) => {
    let i = 0;
    return branch("vertical", pattern.map((size) => {
      const row = nodes.slice(i, i + size);
      i += size;
      return branch("horizontal", row);
    }));
  });
}

export function preferenceTrees(ids: string[], preferences: GuidedPreferences): Tree[] {
  const { focus, pair } = preferences;
  const result: Tree[] = [];
  const axes: Axis[] = pair?.axis === "any" ? ["horizontal", "vertical"] : [pair?.axis ?? "horizontal"];
  for (const axis of axes) {
    const blocks: Tree[] = [];
    let focal: Tree | undefined;
    let paired = false;
    for (const id of ids) {
      let node: Tree = { unit: id };
      if (pair && (id === pair.first || id === pair.second)) {
        if (paired) continue;
        paired = true;
        node = branch(axis, [{ unit: pair.first }, { unit: pair.second }]);
      }
      blocks.push(node);
      if (id === focus || (paired && !("unit" in node) && (focus === pair?.first || focus === pair?.second))) focal = node;
    }
    result.push(...rowOptions(blocks));
    if (focal && blocks.length > 1) {
      for (const rest of rowOptions(blocks.filter((node) => node !== focal))) {
        for (const direction of ["horizontal", "vertical"] as const) result.push(branch(direction, [focal, rest]));
      }
    }
  }
  return [...new Map(result.map((tree) => [JSON.stringify(tree), tree])).values()];
}
