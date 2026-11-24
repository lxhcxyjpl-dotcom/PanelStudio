import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { errorText } from "../model/feedback";
import { openListedProject, openSample } from "../state/session";
import { WishStart } from "./WishStart";
import { Button, Icon } from "./widgets";
import "./start-composer.css";

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const projects = useQuery({ queryKey: ["start-projects"], queryFn: () => api.projects(), refetchOnMount: "always" });
  const recent = [...(projects.data?.items ?? [])].filter(p => !p.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const date = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" });
  async function open(task: () => Promise<unknown>) {
    setError(""); setBusy(true);
    try { await task(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <main className="start-screen">
    <div className="start-inner">
      <section className="start-hero" aria-labelledby="start-heading">
        <div className="start-intro"><h1 id="start-heading">{t("wish.start")}</h1></div>
        <WishStart />

        <Button action="open-sample" variant="quiet" disabled={busy} className="sample-link" onClick={() => void open(openSample)}>
          {t("home.sample")}<Icon name="arrowRight" />
        </Button>
      </section>
      {error && <p role="alert" className="start-error">{error}</p>}
      {recent.length > 0 && <section className="recent-projects" aria-labelledby="recent-heading">
        <h2 id="recent-heading">{t("app.recent")}</h2>
        <div className="recent-list">
          {recent.map(project => <button key={project.id} type="button" data-action="open-recent-project" disabled={busy}
            onClick={() => void open(() => openListedProject(project.id))}>
            <span className="recent-icon"><Icon name="sheets" /></span>
            <span className="recent-copy"><strong>{project.title}</strong><time dateTime={project.updatedAt}>{date.format(new Date(project.updatedAt))}</time></span>
            <Icon name="arrowRight" />
          </button>)}
        </div>
      </section>}
    </div>
  </main>;
}
