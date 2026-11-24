import { layoutUnitIds, RESOURCE_LIMITS, type DomainCommand, type GuidedLayoutRequest, type GuidedPreferences } from "@panelstudio/contracts";
import { DocumentCommandError, framesNearlyEqual } from "@panelstudio/core";
import { assetFacts, autoHeightLimit, croppedAspect, occupiedRects, unionRect, unitGeometry, type Rect } from "./measure.js";
import { preferenceTrees, referenceTree, type Axis, type Tree } from "./guided-tree.js";
import { scoreLayout } from "./score.js";
import type { SolveLayoutFailure, SolveLayoutInput, SolveLayoutResult, SolvedCandidate } from "./solve.js";
import { validateCandidateResult } from "./validate.js";

type Input = Omit<SolveLayoutInput, "request"> & { request: GuidedLayoutRequest };
type Item = { panelId: string; frameMm: Rect };
type Leaf = {
  unit: string; a: number; b: number; minWidth: number; minHeight: number;
  place: (box: Rect) => Item[];
};
type Measured = Leaf | { axis: Axis; children: Measured[]; weights?: number[]; a: number; b: number };
type Gaps = { horizontal: number; vertical: number };

function leavesFor({ document, assets }: Input, ids: string[]): Map<string, Leaf> {
  const leaves = new Map<string, Leaf>();
  const min = document.layoutSettings.minPanelSizeMm;
  for (const unit of ids) {
    const id = unit.slice(6);
    if (unit.startsWith("group:")) {
      const group = document.groups[id]!;
      const { frames, occupied } = unitGeometry(document, { kind: "group", groupId: id, panelIds: group.panelIds });
      leaves.set(unit, { unit, a: occupied.width / occupied.height, b: 0, minWidth: occupied.width, minHeight: occupied.height,
        place: (box) => frames.map(({ panelId, frameMm: f }) => ({ panelId, frameMm: { ...f,
          x: box.x + (box.width - occupied.width) / 2 + f.x - occupied.x,
          y: box.y + (box.height - occupied.height) / 2 + f.y - occupied.y } })) });
      continue;
    }
    const a = croppedAspect(document, assets, id)!;
    const h = Math.max(min.height, min.width / a), w = h * a;
    const ink = unionRect(occupiedRects(document, id, { x: 0, y: 0, width: w, height: h }))!;
    const extraW = ink.width - w, extraH = ink.height - h;
    leaves.set(unit, { unit, a, b: extraW - a * extraH, minWidth: ink.width, minHeight: ink.height,
      place(box) {
        const height = Math.min(box.height - extraH, (box.width - extraW) / a);
        const width = a * height;
        return [{ panelId: id, frameMm: { x: box.x + (box.width - width - extraW) / 2 - ink.x,
          y: box.y + (box.height - height - extraH) / 2 - ink.y, width, height } }];
      } });
  }
  return leaves;
}

// At a common occupied height h, a subtree needs width a*h+b. The intercept
// includes fixed-size label ink and millimetre gutters, even when assets scale.
function measure(tree: Tree, leaves: Map<string, Leaf>, gaps: Gaps): Measured {
  if ("unit" in tree) return leaves.get(tree.unit)!;
  const children = tree.children.map((child) => measure(child, leaves, gaps));
  const total = (term: (child: Measured) => number) => children.reduce((sum, child) => sum + term(child), 0);
  const horizontal = tree.axis === "horizontal", gap = gaps[tree.axis] * (children.length - 1);
  const a = horizontal ? total((c) => c.a) : 1 / total((c) => 1 / c.a);
  const b = horizontal ? total((c) => c.b) + gap : a * (total((c) => c.b / c.a) - gap);
  return { ...tree, children, a, b };
}

function contains(node: Measured, id: string): boolean {
  return "unit" in node ? node.unit === id : node.children.some((child) => contains(child, id));
}
function fit(node: Measured, box: Rect, gaps: Gaps, mode: Mode, focus: string | undefined, items: Item[]): boolean {
  if ("unit" in node) {
    if (box.width + 1e-7 < node.minWidth || box.height + 1e-7 < node.minHeight) return false;
    items.push(...node.place(box));
    return true;
  }
  const horizontal = node.axis === "horizontal";
  const extent = horizontal ? "width" : "height";
  const offset = horizontal ? "x" : "y";
  const gap = gaps[node.axis], available = box[extent] - gap * (node.children.length - 1);
  const natural = node.children.map((child) => horizontal ? child.a * box.height + child.b : (box.width - child.b) / child.a);
  let weights = natural;
  if (mode === "proportion" && node.weights) weights = node.weights;
  if (mode === "emphasis" && focus) weights = natural.map((w, i) => w * (contains(node.children[i]!, focus) ? 1.75 : 1));
  if (available <= 0 || weights.some((v) => !(v > 0))) return false;
  const total = weights.reduce((a, b) => a + b, 0);
  let start = box[offset];
  return node.children.every((child, i) => {
    const size = available * weights[i]! / total;
    const next = { ...box, [offset]: start, [extent]: size };
    start += size + gap;
    return fit(child, next, gaps, mode, focus, items);
  });
}

type Mode = "structure" | "proportion" | "emphasis";
function adjacent(first: Rect, second: Rect, axis: Axis, gap: number): boolean {
  if (axis === "vertical") {
    const transpose = (r: Rect): Rect => ({ x: r.y, y: r.x, width: r.height, height: r.width });
    return adjacent(transpose(first), transpose(second), "horizontal", gap);
  }
  const separation = Math.max(second.x - first.x - first.width, first.x - second.x - second.width);
  const shared = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return separation >= -0.02 && separation <= gap + 1.5 && shared >= Math.min(first.height, second.height) * 0.4;
}
function matches(p: GuidedPreferences, bounds: Map<string, Rect>, occupied: (id: string) => Rect, gaps: Gaps, ratio: number): boolean {
  if (p.shape && (ratio > 1.15 ? "wide" : ratio < 1 / 1.15 ? "tall" : "square") !== p.shape) return false;
  if (p.focus) {
    const main = bounds.get(p.focus)!;
    for (const [id, r] of bounds) if (id !== p.focus && main.width * main.height < 1.08 * r.width * r.height) return false;
  }
  if (!p.pair) return true;
  const { first, second, axis } = p.pair;
  const aBox = occupied(first), bBox = occupied(second);
  return (["horizontal", "vertical"] as const).some((a) => (a === axis || axis === "any") &&
    adjacent(aBox, bBox, a, gaps[a]));
}
function fail(reason: SolveLayoutFailure["details"]["reason"], message: string, code: SolveLayoutFailure["code"] = "LAYOUT_CONFLICT"): SolveLayoutFailure {
  return { ok: false, code, message, details: { reason } };
}

export function solveGuided(input: Input): SolveLayoutResult {
  const { document, request, assets } = input;
  const { referenceSlots: slots, preferences: p } = request;
  const ids = layoutUnitIds(document), panels = document.panelOrder;
  if (panels.length > RESOURCE_LIMITS.maxAutoLayoutPanels || ids.length < 2)
    return fail("invalid-units", `Guided layout requires 2 to ${RESOURCE_LIMITS.maxAutoLayoutPanels} panels and at least two independent units.`, "REQUEST_INVALID");
  if (panels.some((id) => !croppedAspect(document, assets, id))) return fail("invalid-units", "A panel is missing its asset.", "DOCUMENT_INVALID");
  if ((!slots && (!Object.keys(p).length || request.referenceAspect !== undefined)) || (p.focus && !ids.includes(p.focus)) ||
    (p.pair && (!ids.includes(p.pair.first) || !ids.includes(p.pair.second) || p.pair.first === p.pair.second)))
    return fail("guided-preferences", "Choose preferences for units in this figure.", "REQUEST_INVALID");
  if (slots && (slots.length !== ids.length || !ids.every((id) => slots.some((s) => s.unitId === id)) ||
    slots.some((s) => s.x + s.width > 1.000001 || s.y + s.height > 1.000001)))
    return fail("reference-slots", "Map one in-bounds reference region to each layout unit.", "REQUEST_INVALID");
  const trees = slots ? [referenceTree(slots)] : preferenceTrees(ids, p);
  if (!trees[0]) return fail("reference-structure", "Reference regions cannot be separated into rows and columns.");
  const settings = document.layoutSettings;
  const canvas = { ...document.canvas, widthMm: request.widthMm ?? document.canvas.widthMm };
  const m = canvas.marginsMm;
  const gaps = p.gapMm === undefined ? settings.gutterMm : { horizontal: p.gapMm, vertical: p.gapMm };
  const leaves = leavesFor(input, ids);
  const availableW = canvas.widthMm - m.left - m.right;
  const fixed = canvas.heightMode === "fixed";
  const maxH = (fixed ? canvas.heightMm : autoHeightLimit(document)) - m.top - m.bottom;
  const source = slots ? unionRect(slots) : null;
  const candidates = new Map<string, SolvedCandidate>();
  let failure: SolveLayoutFailure | undefined;
  const modes: Mode[] = ["structure"];
  if (source) modes.push("proportion");
  else if (p.focus) modes.push("emphasis");
  for (const layout of trees) {
    const root = measure(layout!, leaves, gaps);
    for (const mode of modes) {
      const proportional = mode === "proportion" && source && request.referenceAspect
        ? request.referenceAspect * source.width / source.height : null;
      const desiredRatio = p.shape === "wide" ? 1.45 : p.shape === "tall" ? 0.76 : 1;
      const targetH = p.shape && !fixed ? Math.min(maxH, canvas.widthMm / desiredRatio - m.top - m.bottom) : maxH;
      const width = Math.min(availableW, proportional ? proportional * targetH : root.a * targetH + root.b);
      const height = proportional ? width / proportional : (width - root.b) / root.a;
      if (!(width > 0 && height > 0)) continue;
      const heightMm = fixed ? canvas.heightMm : m.top + (p.shape ? targetH : height) + m.bottom;
      const box = { x: m.left + (availableW - width) / 2, y: m.top + (heightMm - m.top - m.bottom - height) / 2, width, height };
      const items: Item[] = [];
      if (!fit(root, box, gaps, mode, p.focus, items)) continue;
      const bounds = new Map(items.map(({ panelId, frameMm }) => ["panel:" + panelId, frameMm]));
      for (const [gid, group] of Object.entries(document.groups))
        bounds.set("group:" + gid, unionRect(group.panelIds.map((id) => bounds.get("panel:" + id)!))!);
      for (const id of [...bounds.keys()]) if (!ids.includes(id)) bounds.delete(id);
      const occupied = (unit: string) => {
        const id = unit.slice(6);
        const members = unit.startsWith("group:") ? document.groups[id]!.panelIds : [id];
        return unionRect(items.filter((i) => members.includes(i.panelId)).flatMap((i) => occupiedRects(document, i.panelId, i.frameMm)))!;
      };
      if (!matches(p, bounds, occupied, gaps, canvas.widthMm / heightMm)) continue;
      const key = ids.map((id) => Object.values(bounds.get(id)!).map((v) => Math.round(v * 100)).join(",")).join("|");
      if (candidates.has(key)) continue;
      const commands: DomainCommand[] = [];
      const primary = p.focus ? (p.focus.startsWith("panel:") ? p.focus.slice(6) : null) : settings.primaryPanelId;
      if (primary !== settings.primaryPanelId || gaps.horizontal !== settings.gutterMm.horizontal || gaps.vertical !== settings.gutterMm.vertical)
        commands.push({ type: "layout.setSettings", layoutSettings: { ...settings, primaryPanelId: primary, gutterMm: gaps } });
      if (canvas.widthMm !== document.canvas.widthMm || Math.abs(canvas.heightMm - heightMm) > 1e-7) commands.push({ type: "canvas.set", canvas: { ...canvas, heightMm } });
      if (items.some((i) => !framesNearlyEqual(document.panels[i.panelId]!.frameMm, i.frameMm))) commands.push({ type: "panel.setFrames", items });
      try {
        const previewDocument = validateCandidateResult(document, commands, (id) => assetFacts(assets, id), "layout");
        const emphasisId = p.focus?.startsWith("panel:") ? p.focus.slice(6) : null;
        const scored = scoreLayout(document, previewDocument, assets, "guided", emphasisId);
        const summary = slots ? mode === "proportion" ? "参考区域比例" : "参考行列结构" : "按排版偏好";
        candidates.set(key, { family: "guided", commands, previewDocument, summary, ...scored });
      } catch (error) {
        if (!(error instanceof DocumentCommandError)) throw error;
        failure ??= { ok: false, code: error.code, message: error.message, details: error.details };
      }
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => (a.score.total ?? 1) - (b.score.total ?? 1));
  return ranked.length ? { ok: true, candidates: ranked.slice(0, input.maxCandidates ?? RESOURCE_LIMITS.maxLayoutCandidates) }
    : failure ?? fail("guided-preferences", "No layout fits these regions and preferences at the current panel sizes.");
}
