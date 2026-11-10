import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { errorText } from "../model/feedback";
import { openListedProject, openSample } from "../state/session";
import { Button, Icon } from "./widgets";

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState("");
  const projects = useQuery({ queryKey: ["start-projects"], queryFn: () => api.projects(), refetchOnMount: "always" });
  const recent = [...(projects.data?.items ?? [])].filter(p => !p.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const date = new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "short", day: "numeric" });
  async function open(task: Promise<void>) {
    setError("");
    try { await task; } catch (err) { setError(errorText(err)); }
  }
  return <main className="start-screen">
    <div className="start-inner">
      <section className="start-hero" aria-labelledby="start-heading">
        <div className="start-intro">
          <h1 id="start-heading">{t("app.emptyTitle")}</h1>
          <p>{t("app.emptyBody")}</p>
          <div className="empty-actions">
            <Button action="empty-import" variant="primary" onClick={() => document.getElementById("import-input")?.click()}>
              <Icon name="plus" />{t("toolbar.import")}
            </Button>
            <Button action="open-sample" onClick={() => void open(openSample())}>{t("app.openSample")}<Icon name="arrowRight" /></Button>
          </div>
          <small>{t("app.formats")}</small>
        </div>
        <div className="start-photo"><img src="/studio-proof.webp" alt="" width="1200" height="800" /></div>
      </section>
      {error && <p role="alert" className="start-error">{error}</p>}
      {recent.length > 0 && <section className="recent-projects" aria-labelledby="recent-heading">
        <h2 id="recent-heading">{t("app.recent")}</h2>
        <div className="recent-list">
          {recent.map(project => <button key={project.id} type="button" data-action="open-recent-project"
            onClick={() => void open(openListedProject(project.id))}>
            <span className="recent-icon"><Icon name="sheets" /></span>
            <span className="recent-copy"><strong>{project.title}</strong><time dateTime={project.updatedAt}>{date.format(new Date(project.updatedAt))}</time></span>
            <Icon name="arrowRight" />
          </button>)}
        </div>
      </section>}
    </div>
  </main>;
}
