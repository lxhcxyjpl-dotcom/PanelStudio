import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Check } from "typebox/value";
import { referenceTree } from "@panelstudio/layout";
import { LayoutExampleSchema, layoutUnitIds, type FigureDocumentV1, type LayoutExample } from "@panelstudio/contracts";
import { getProject, getRevision } from "./db.js";
import type { AppContext } from "./pipeline.js";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, " ").trim();
}

function terms(text: string): string[] {
  const result = normalize(text).split(/\s+/u).filter((s) => s.length > 1);
  const concepts = [
    ["蛋白降解", "靶向降解", "protac", "lytac", "protein degradation"],
    ["肿瘤", "癌", "cancer", "oncology", "tumor"],
    ["生物医学", "biomedical", "medicine"],
    ["单细胞", "single cell", "scrna", "空间组学", "spatial"],
    ["神经", "neuro", "brain"], ["免疫", "immune", "immunology"],
  ];
  for (const [index, names] of concepts.entries()) {
    if (names.some((name) => normalize(text).includes(name))) result.push("concept" + index);
  }
  return [...new Set(result)];
}

function validExample(input: unknown): input is LayoutExample {
  return Check(LayoutExampleSchema, input) &&
    input.panelTypes.length === input.slots.length &&
    input.slots.every((slot) => slot.x + slot.width <= 1.000001 && slot.y + slot.height <= 1.000001) &&
    referenceTree(input.slots.map((slot, index) => ({ ...slot, unitId: "slot-" + index }))) !== null;
}

function readLibrary(ctx: AppContext): LayoutExample[] {
  const file = path.join(ctx.dataDir, "layout-references.json");
  try {
    if (statSync(file).size > 8_000_000) return [];
    const entries: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(entries) ? entries.filter(validExample) : [];
  } catch { return []; }
}

export function rememberLayoutChoice(ctx: AppContext, projectId: string, revision: number, document: FigureDocumentV1): void {
  const units = layoutUnitIds(document);
  if (units.length < 2) return;
  const frames = units.map((unit) => {
    const id = unit.slice(6);
    const members = unit.startsWith("group:") ? document.groups[id]!.panelIds : [id];
    const boxes = members.map((member) => document.panels[member]!.frameMm);
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
  });
  const x = Math.min(...frames.map((r) => r.x)), y = Math.min(...frames.map((r) => r.y));
  const width = Math.max(...frames.map((r) => r.x + r.width)) - x;
  const height = Math.max(...frames.map((r) => r.y + r.height)) - y;
  const context = document.publicationContext;
  const example: LayoutExample = {
    id: "choice-" + projectId + "-" + revision, origin: "accepted",
    journal: context?.journal ?? "", field: context?.field ?? "", aspect: width / height,
    panelTypes: units.map((unit) => unit.startsWith("group:") ? "composite" : "unknown"),
    slots: frames.map((r) => ({ x: (r.x - x) / width, y: (r.y - y) / height, width: r.width / width, height: r.height / height })),
  };
  if (!validExample(example)) return;
  ctx.db.prepare("INSERT INTO layout_choices(projectId, revision, exampleJson) VALUES (?, ?, ?)").run(projectId, revision, JSON.stringify(example));
}

export function selectLayoutExamples(ctx: AppContext, document: FigureDocumentV1): LayoutExample[] {
  const count = layoutUnitIds(document).length;
  if (count < 2) return [];
  const context = document.publicationContext;
  const journal = normalize(context?.journal ?? "");
  const field = terms(context?.field ?? "");
  const rows = ctx.db.prepare(
    "SELECT c.projectId, c.revision, c.exampleJson FROM layout_choices c JOIN projects p ON p.id=c.projectId WHERE p.deletedAt IS NULL ORDER BY p.updatedAt DESC, c.revision DESC LIMIT 100",
  ).all() as Array<{projectId: string; revision: number; exampleJson: string}>;
  const activeHashes = new Map<string, Set<string>>();
  const activeChoices = rows.filter((row) => {
    const project = getProject(ctx.db, row.projectId);
    if (!project) return false;
    let hashes = activeHashes.get(project.id);
    if (!hashes) {
      hashes = new Set([project.currentRevision, ...project.undoStack].flatMap((revision) => {
        const saved = getRevision(ctx.db, project.id, revision);
        return saved ? [saved.documentHash] : [];
      }));
      activeHashes.set(project.id, hashes);
    }
    const chosen = getRevision(ctx.db, project.id, row.revision);
    return Boolean(chosen && hashes.has(chosen.documentHash));
  }).map((row) => JSON.parse(row.exampleJson) as unknown).filter(validExample);
  const seen = new Set<string>();
  return [...activeChoices, ...readLibrary(ctx)]
    .filter((entry) => {
      if (entry.slots.length !== count || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .map((entry, index) => {
      const matchJournal = Boolean(journal && normalize(entry.journal) === journal);
      const candidateTerms = terms(entry.field + " " + (entry.title ?? ""));
      const matchField = field.filter((word) => candidateTerms.some((term) => term === word ||
        term.includes(word) || word.includes(term))).length;
      return { entry, index, matchJournal, matchField,
        score: (matchJournal ? 8 : 0) + Math.min(4, matchField) + (entry.origin === "accepted" ? 2 : 0) };
    })
    .filter(({ entry, matchJournal, matchField }) => {
      if (!journal && !field.length) return true;
      return matchJournal || matchField > 0 || entry.origin === "accepted" && !entry.journal && !entry.field;
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 6)
    .map(({ entry }) => entry);
}

