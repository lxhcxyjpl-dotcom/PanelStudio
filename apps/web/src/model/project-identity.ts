import type { Project } from "@panelstudio/contracts";

/** Creation times remain useful when editing one of several same-name projects. */
export function duplicateCreationDates(projects: readonly Project[], locale: string): Map<string, string> {
  const grouped = new Map<string, Project[]>();
  for (const project of projects) {
    const key = project.title.trim();
    const group = grouped.get(key);
    if (group) group.push(project);
    else grouped.set(key, [project]);
  }

  const dates = new Map<string, string>();
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" });
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const occurrences = new Map<string, Project[]>();
    for (const project of group) {
      const time = format.format(new Date(project.createdAt));
      const entries = occurrences.get(time);
      if (entries) entries.push(project);
      else occurrences.set(time, [project]);
    }
    for (const [time, entries] of occurrences) {
      entries.forEach((project, index) => dates.set(project.id, entries.length > 1 ? `${time} · ${index + 1}` : time));
    }
  }
  return dates;
}
