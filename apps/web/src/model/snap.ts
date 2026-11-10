export type Rect = { x: number; y: number; width: number; height: number };

export type Guide = { axis: "x" | "y"; mm: number };

type SnapInput = {
  bounds: Rect;
  dx: number;
  dy: number;
  canvas: { widthMm: number; heightMm: number; marginsMm: { top: number; right: number; bottom: number; left: number } };
  others: Rect[];
  toleranceMm: number;
  enabled: boolean;
};

/**
 * Snaps a translation to canvas edges, safety margins, and other panel edges
 * and centers. The tolerance is 6 screen pixels converted by the caller.
 */
export function snapTranslation(input: SnapInput): { dx: number; dy: number; guides: Guide[] } {
  if (!input.enabled || !(input.toleranceMm > 0)) return { dx: input.dx, dy: input.dy, guides: [] };
  const proposed = {
    x: input.bounds.x + input.dx,
    y: input.bounds.y + input.dy,
    width: input.bounds.width,
    height: input.bounds.height,
  };
  const xTargets = [
    0,
    input.canvas.marginsMm.left,
    input.canvas.widthMm - input.canvas.marginsMm.right,
    input.canvas.widthMm,
  ];
  const yTargets = [
    0,
    input.canvas.marginsMm.top,
    input.canvas.heightMm - input.canvas.marginsMm.bottom,
    input.canvas.heightMm,
  ];
  for (const other of input.others) {
    xTargets.push(other.x, other.x + other.width / 2, other.x + other.width);
    yTargets.push(other.y, other.y + other.height / 2, other.y + other.height);
  }
  const xSnap = nearest(
    [proposed.x, proposed.x + proposed.width / 2, proposed.x + proposed.width],
    xTargets,
    input.toleranceMm,
  );
  const ySnap = nearest(
    [proposed.y, proposed.y + proposed.height / 2, proposed.y + proposed.height],
    yTargets,
    input.toleranceMm,
  );
  const guides: Guide[] = [];
  if (xSnap) guides.push({ axis: "x", mm: xSnap.target });
  if (ySnap) guides.push({ axis: "y", mm: ySnap.target });
  return {
    dx: input.dx + (xSnap?.delta ?? 0),
    dy: input.dy + (ySnap?.delta ?? 0),
    guides,
  };
}

function nearest(edges: number[], targets: number[], tolerance: number): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target };
    }
  }
  return best;
}

export function boundsOf(rects: Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const rect of rects.slice(1)) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
