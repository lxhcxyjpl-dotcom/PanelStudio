import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { errorText } from "../../model/feedback";
import { navigate, projectPath } from "../../navigation";
import { readProjectId } from "../../prefs";
import { importPackage, newProject, openListedProject } from "../../state/session";
import { patch, useWorkspace } from "../../state/store";
import { Brand } from "../Brand";
import { Button, Icon } from "../widgets";
import { CompositionReplay, HeroShowcase, type ShowcaseExample } from "./FigureReplay";
import "./home.css";

const docs = "https://github.com/lxhcxyjpl-dotcom/PanelStudio/blob/main/";
export function HomePage() {
  const { t, i18n } = useTranslation();
  const projectId = useWorkspace(s => s.projectId) ?? readProjectId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const showcase = useQuery({ queryKey: ["showcase"], staleTime: Infinity, queryFn: async () => {
    const response = await fetch("/showcase/catalog.json");
    if (!response.ok) throw new Error(t("brand.showcaseError"));
    return await response.json() as { examples: ShowcaseExample[] };
  } });
  const projects = useQuery({ queryKey: ["start-projects"], queryFn: () => api.projects(), refetchOnMount: "always" });
  const recent = [...(projects.data?.items ?? [])].filter(p => !p.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const examples = showcase.data?.examples ?? [];
  const date = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" });
  async function run(task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function openExample(example: ShowcaseExample) {
    const response = await fetch(example.exports.project.url);
    if (!response.ok) throw new Error(t("brand.showcaseError"));
    await importPackage(new File([await response.blob()], example.id + ".figurezip", { type: "application/zip" }));
  }
  return <main className="brand-page" data-testid="home-page">
    <div className="brand-container">
      <header className="brand-nav"><a href="/" aria-label="PanelStudio"><Brand /></a>
        <nav aria-label="PanelStudio"><a href={docs + "README.md"}>{t("brand.docs")}</a><a href="#about">{t("brand.about")}</a>
          {projectId && <a className="brand-resume" href={projectPath(projectId)} onClick={event => { event.preventDefault(); void navigate(projectPath(projectId)); }}>{t("brand.resume")}<Icon name="arrowRight" /></a>}
          <Button action="settings" variant="quiet" aria-label={t("toolbar.settings")} onClick={() => patch({ dialog: "settings" })}><Icon name="settings" /></Button>
        </nav>
      </header>
      <section className="brand-hero" data-testid="home-hero"><div className="brand-intro">
        <h1>{t("brand.headline")}</h1><p>{t("brand.description")}</p>
        <div className="brand-hero-actions"><Button action="create-figure" variant="primary" disabled={busy} onClick={() => void run(() => newProject())}>{t("brand.create")}</Button>
          <a href="#examples" className="brand-text-link">{t("brand.examples")}<Icon name="arrowRight" /></a></div>
        {error && <p className="brand-error" role="alert">{error}</p>}
      </div>{examples.length ? <HeroShowcase examples={examples} /> : <div className="showcase-placeholder" role="status">{showcase.isError ? t("brand.showcaseError") : t("app.opening")}</div>}</section>
      {examples[0] && <CompositionReplay example={examples[0]} />}
      <section className="brand-workflow" aria-label="Arrange, refine, export">
        <article><h2>Arrange</h2><h3>{t("brand.arrangeTitle")}</h3><p>{t("brand.arrangeBody")}</p><Button variant="quiet" action="home-arrange" disabled={busy} onClick={() => void run(() => newProject())}>{t("brand.create")}<Icon name="arrowRight" /></Button></article>
        <article><h2>Refine</h2><h3>{t("brand.refineTitle")}</h3><p>{t("brand.refineBody")}</p></article>
        <article><h2>Export</h2><h3>{t("brand.exportTitle")}</h3><p>{t("brand.exportBody")}</p><a href={docs + "docs/format-support.md"}>{t("brand.compatibility")}<Icon name="arrowRight" /></a></article>
      </section>
      <section className="brand-projects"><div className="brand-section-heading"><h2>{t("brand.recent")}</h2><Button action="all-projects" variant="quiet" onClick={() => patch({ dialog: "projects" })}>{t("brand.allProjects")}<Icon name="arrowRight" /></Button></div>
        {projects.isError ? <div className="brand-project-message"><p>{t("route.offline")}</p><Button variant="quiet" action="retry-projects" onClick={() => void projects.refetch()}>{t("route.retry")}</Button></div>
          : projects.isPending ? <p className="brand-project-message" role="status">{t("app.opening")}</p>
          : recent.length ? recent.map(project => <button key={project.id} type="button" className="brand-project-row" data-action="open-recent-project" disabled={busy} onClick={() => void run(() => openListedProject(project.id))}>
            <Icon name="sheets" /><strong>{project.title}</strong><time dateTime={project.updatedAt}>{date.format(new Date(project.updatedAt))}</time><Icon name="arrowRight" /></button>)
          : <div className="brand-project-message"><p>{t("brand.noProjects")}</p><Button action="new-project-home" variant="quiet" disabled={busy} onClick={() => void run(() => newProject())}>{t("brand.create")}<Icon name="plus" /></Button></div>}
      </section>
      <section className="brand-examples" id="examples"><div className="brand-section-heading"><h2>{t("brand.examplesTitle")}</h2></div>
        <div className="brand-example-grid">{examples.map(example => <article key={example.id}>
          <button className="brand-example-image" data-action="open-scientific-example" disabled={busy} onClick={() => void run(() => openExample(example))} aria-label={`${t("brand.openExample")} · ${t("brand." + example.id)}`}>
            <img src={example.exports.png.url} width="1200" height="800" loading="lazy" alt={`${t("brand." + example.id)} · ${t("brand.synthetic")}`} /></button>
          <div className="brand-example-heading"><h3>{t("brand." + example.id)}</h3><Button action="copy-scientific-example" variant="quiet" disabled={busy} onClick={() => void run(() => openExample(example))}>{t("brand.openExample")}<Icon name="arrowRight" /></Button></div>
        </article>)}</div><p className="showcase-caption">{t("brand.synthetic")}</p>
      </section>
      <footer className="brand-footer" id="about"><div><Brand /><p>{t("brand.aboutBody")}</p></div><nav aria-label={t("brand.docs")}>
        <a href={docs + "docs/format-support.md"}>{t("brand.compatibility")}</a><a href={docs + "docs/licenses.md"}>{t("brand.licenses")}</a><a href="https://github.com/lxhcxyjpl-dotcom/PanelStudio">GitHub</a>
        <Button variant="quiet" action="open-onboarding" onClick={() => patch({ dialog: "onboarding" })}>{t("onboarding.title")}</Button></nav>
      </footer>
    </div>
  </main>;
}
