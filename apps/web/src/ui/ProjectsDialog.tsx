import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { errorText } from "../model/feedback";
import { duplicateCreationDates } from "../model/project-identity";
import { deleteCurrentProject, openListedProject, restoreListedProject } from "../state/session";
import { useWorkspace } from "../state/store";
import { queryClient } from "../state/query";
import { Shell } from "./DialogShell";
import { Button, Icon } from "./widgets";
import "./project-library.css";

export function ProjectsDialog({ open }: { open: boolean }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const current = useWorkspace(s => s.projectId);
  const projects = useQuery({ queryKey: ["project-library"], enabled: open,
    queryFn: () => api.projects({ includeDeleted: true }), refetchOnMount: "always" });
  const sectionItems = (projects.data?.items ?? []).filter(project => Boolean(project.deletedAt) === trash);
  const term = search.trim().toLocaleLowerCase();
  const matches = sectionItems.filter(project => project.title.toLocaleLowerCase().includes(term))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const items = matches.slice(0,visibleCount);
  const emptyMessage = sectionItems.length ? "project.noMatches" : trash ? "project.emptyTrash" : "project.empty";
  const date = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" });
  const duplicateDates = duplicateCreationDates(sectionItems, i18n.language);
  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await task(); await Promise.all([projects.refetch(), queryClient.invalidateQueries({ queryKey: ["start-projects"] })]); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Shell open={open} title={t("brand.allProjects")} className="projects-dialog">
    <div className="project-library-tools"><label className="field"><span className="sr-only">{t("project.search")}</span><input data-testid="project-search" value={search} placeholder={t("project.search")} onChange={event => { setSearch(event.target.value); setVisibleCount(50); }} /></label>
      <Button action="project-active" variant="quiet" aria-pressed={!trash} onClick={() => setTrash(false)}>{t("project.active")}</Button>
      <Button action="project-trash" variant="quiet" aria-pressed={trash} onClick={() => setTrash(true)}>{t("project.trash")}</Button></div>
    {(error || projects.isError) && <p role="alert">{error || t("route.offline")}</p>}
    <div className="project-library-list">{items.map(project => {
      const creationDate = duplicateDates.get(project.id);
      const detailId = creationDate ? "project-created-" + project.id : undefined;
      return <div className="project-library-row" key={project.id}>
        <Icon name="sheets" />
        <div className="project-library-identity">
          <button type="button" data-action="open-listed-project" disabled={busy || trash}
            aria-describedby={detailId} onClick={() => void run(() => openListedProject(project.id))} title={project.title}>{project.title}</button>
          {creationDate && <time className="project-created" id={detailId} dateTime={project.createdAt}>{t("project.createdAt", { date: creationDate })}</time>}
        </div>
        {!creationDate && <time dateTime={project.updatedAt}>{date.format(new Date(project.updatedAt))}</time>}
        {trash ? <Button action="restore-listed-project" variant="quiet" disabled={busy} aria-describedby={detailId}
          onClick={() => void run(() => restoreListedProject(project.id))}>{t("toolbar.restoreProject")}</Button>
          : <Button action="delete-listed-project" variant="quiet" disabled={busy} aria-describedby={detailId}
            aria-label={t("toolbar.deleteProject") + ": " + project.title}
            onClick={() => void run(() => project.id === current ? deleteCurrentProject() : api.deleteProject(project.id))}><Icon name="trash" /></Button>}
      </div>;
    })}</div>
    {projects.isSuccess && !items.length && <p className="muted" role="status">{t(emptyMessage)}</p>}
    {projects.isPending && <p role="status">{t("app.opening")}</p>}
    {matches.length > items.length && <Button action="more-projects" onClick={() => setVisibleCount(count=>count+50)}>{t("project.more")}</Button>}
  </Shell>;
}
