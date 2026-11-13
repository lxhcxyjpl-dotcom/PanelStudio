import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { errorText } from "../model/feedback";
import { ensureProject, openListedProject, openSample } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { markOnboardingSeen, useOnboardingSeen } from "./onboarding-preference";
import { Button, Icon } from "./widgets";

export function StartScreen() {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const message = useWorkspace(state => state.startMessage);
  const seenGuide = useOnboardingSeen();
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
          <label className="sr-only" htmlFor="start-brief">{t("publication.message")}</label>
          <textarea id="start-brief" ref={input} data-testid="start-brief" rows={3} maxLength={1000} value={message}
            placeholder={t("home.prompt")} onChange={event => patch({ startMessage: event.target.value })}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault(); if (!busy && message.trim()) void open(() => ensureProject());
              }
            }} />
          <div className="start-composer-tools">
            <Button action="empty-import" variant="quiet" disabled={busy} title={t("app.formats")}
              onClick={() => document.getElementById("import-input")?.click()}><Icon name="plus" />{t("toolbar.import")}</Button>
            <span className="home-formats">PNG · JPG · SVG</span>
            <Button action="start-figure" variant="primary" className="round-send" type="submit" disabled={busy || !message.trim()}
              aria-label={t("home.begin")} title={t("home.begin")}><Icon name="arrowUp" /></Button>
          </div>
        </form>
        <div className="home-suggestions" aria-label={t("home.ideas")}>
          {(["comparison", "emphasis", "compact"] as const).map(key => <Button key={key} action={"start-idea-" + key} variant="quiet"
            onClick={() => { patch({ startMessage: t("home.idea." + key) }); input.current?.focus(); }}>
            <Icon name={key === "comparison" ? "reference" : key === "emphasis" ? "spark" : "layout"} />{t("home.chip." + key)}
          </Button>)}
        </div>
        <Button action="open-sample" variant="quiet" disabled={busy} className="sample-link" onClick={() => void open(openSample)}>
          {t("home.sample")}<Icon name="arrowRight" />
        </Button>
      </section>
      {error && <p role="alert" className="start-error">{error}</p>}
      {!seenGuide && <section className="welcome-guide" aria-label={t("onboarding.title")}>
        <span className="welcome-guide-icon"><Icon name="book" /></span>
        <div><strong>{t("home.welcome")}</strong><p>{t("home.welcomeHint")}</p></div>
        <Button action="start-onboarding" variant="quiet" onClick={() => patch({ dialog: "onboarding" })}>{t("home.guide")}<Icon name="arrowRight" /></Button>
        <Button action="dismiss-onboarding" className="guide-dismiss" variant="quiet" aria-label={t("onboarding.dismiss")} onClick={markOnboardingSeen}><Icon name="close" /></Button>
      </section>}
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
