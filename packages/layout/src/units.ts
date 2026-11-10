import type { FigureDocumentV1 } from "@panelstudio/contracts";
import { parseUnitId, type Unit } from "./measure.js";
import type { SolveLayoutFailure } from "./solve.js";

function fail(message: string, details: SolveLayoutFailure["details"] = {}): SolveLayoutFailure {
  return { ok: false, code: "REQUEST_INVALID", message, details: { reason: "invalid-units", ...details } };
}

export function parseUnitList(
  document: FigureDocumentV1,
  membership: Map<string, string>,
  ids: string[],
  seen: Set<string>,
): { ok: true; units: Unit[] } | { ok: false; failure: SolveLayoutFailure } {
  const units: Unit[] = [];
  const seenGroups = new Set<string>();
  for (const value of ids) {
    const parsed = parseUnitId(value);
    if (!parsed) return { ok: false, failure: fail("A layout unit id is invalid.") };
    if (parsed.kind === "panel") {
      if (!document.panels[parsed.id]) {
        return { ok: false, failure: fail("The layout names a missing panel.", { panelIds: [parsed.id] }) };
      }
      if (membership.has(parsed.id)) {
        return {
          ok: false,
          failure: fail("A grouped panel can only participate as its group.", { panelIds: [parsed.id] }),
        };
      }
      if (seen.has(parsed.id)) {
        return { ok: false, failure: fail("A panel is listed more than once.", { panelIds: [parsed.id] }) };
      }
      seen.add(parsed.id);
      units.push({ kind: "panel", panelId: parsed.id });
      continue;
    }
    const group = document.groups[parsed.id];
    if (!group) return { ok: false, failure: fail("The layout names a missing group.") };
    if (seenGroups.has(parsed.id)) return { ok: false, failure: fail("A group is listed more than once.") };
    seenGroups.add(parsed.id);
    for (const panelId of group.panelIds) {
      if (seen.has(panelId)) {
        return { ok: false, failure: fail("A panel is listed more than once.", { panelIds: [panelId] }) };
      }
      seen.add(panelId);
    }
    units.push({ kind: "group", groupId: parsed.id, panelIds: [...group.panelIds] });
  }
  return { ok: true, units };
}
