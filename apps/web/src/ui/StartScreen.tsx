import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { errorText } from "../model/feedback";
import { ensureProject, openListedProject, openSample } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { Button, Icon } from "./widgets";
import "./start-composer.css";

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const message = useWorkspace(state => state.startMessage);
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
        <div className="start-intro"><h1 id="start-heading">{t("app.emptyTitle")}</h1></div>
        <form className="start-composer" onSubmit={event => { event.preventDefault(); if (!busy && message.trim()) void open(() => ensureProject()); }}>
          <div className="start-brief-input">
            <label className="sr-only" htmlFor="start-brief">{t("publication.message")}</label>
            <textarea id="start-brief" ref={input} data-testid="start-brief" rows={3} maxLength={1000} value={message}
              placeholder={t("home.prompt")} onChange={event => patch({ startMessage: event.target.value })}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault(); if (!busy && message.trim()) void open(() => ensureProject());
                }
              }} />
            {!message && <div className="home-suggestions" role="group" aria-label={t("home.ideas")}>
              {(["comparison", "emphasis", "compact"] as const).map(key => (
                <Button key={key} action={"start-idea-" + key} variant="quiet"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => { input.current?.focus(); patch({ startMessage: t("home.idea." + key) }); }}>
                  <Icon name={key === "comparison" ? "reference" : key === "emphasis" ? "spark" : "layout"} />{t("home.chip." + key)}
                </Button>
              ))}
            </div>}
          </div>
          <div className="start-composer-tools">
            <Button action="empty-import" variant="quiet" disabled={busy} aria-describedby="start-import-formats"
              onClick={() => document.getElementById("import-input")?.click()}><Icon name="plus" />{t("toolbar.import")}</Button>
            <span id="start-import-formats" className="home-formats" role="tooltip">{t("app.formats")}</span>
            <Button action="start-figure" variant="primary" className="round-send" type="submit" disabled={busy || !message.trim()}
              aria-label={t("home.begin")} title={t("home.begin")}><Icon name="arrowUp" /></Button>
          </div>
        </form>
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
