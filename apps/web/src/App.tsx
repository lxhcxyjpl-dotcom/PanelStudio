import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Workspace } from "./ui/Workspace";
import { HomePage } from "./ui/home/HomePage";
import { Dialogs } from "./ui/Dialogs";
import { Onboarding } from "./ui/Onboarding";
import { GuidedDialog } from "./ui/GuidedDialog";
import { FileInputs } from "./ui/FileInputs";
import { Button } from "./ui/widgets";
import { connectNavigation, navigate, parseRoute, projectPath, useNavigation } from "./navigation";
import { boot, hasUnsettledEdits, loadProject, newProject, prepareNavigation } from "./state/session";
import { useWorkspace } from "./state/store";
import { readProjectId } from "./prefs";
import { ensureEditorFonts } from "./editor-fonts";
import { ApiClientError } from "./api/client";
import { i18n } from "./i18n";

async function resolveRoute(route: ReturnType<typeof parseRoute>, isCurrent: () => boolean): Promise<string | undefined> {
  if (route.kind === "home") return;
  if (route.kind === "missing") throw new Error(i18n.t("route.notFound"));
  await ensureEditorFonts();
  if (!isCurrent()) return;
  const current = useWorkspace.getState();
  const id = route.projectId ?? current.projectId ?? readProjectId();
  if (!id) return "/app";
  if (current.projectId !== id || !current.confirmed) {
    try { await loadProject(id, isCurrent); }
    catch (error) {
      if (error instanceof ApiClientError && error.status === 0) throw new Error(i18n.t("route.offline"));
      if (error instanceof ApiClientError && error.status === 404) throw new Error(i18n.t("app.projectMissing"));
      throw error;
    }
  }
  return projectPath(id);
}

export function App() {
  const { t } = useTranslation();
  const nav = useNavigation();
  const state = useWorkspace();
  const route = parseRoute(nav.path);
  const [editorReady, setEditorReady] = useState(false);
  const [fontError, setFontError] = useState(false);
  useEffect(() => {
    const stop = connectNavigation(resolveRoute, prepareNavigation);
    let active = true;
    void boot().then(() => { if (active) void navigate(location.pathname, { replace: true, initial: true }); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsettledEdits()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { active = false; stop(); window.removeEventListener("beforeunload", beforeUnload); };
  }, []);
  useEffect(() => {
    if (route.kind !== "editor" || editorReady) return;
    void ensureEditorFonts().then(() => setEditorReady(true), () => setFontError(true));
  }, [route.kind, editorReady]);
  const activeEditor = route.kind === "editor" && !nav.error;
  return (
    <Tooltip.Provider delayDuration={400}>
      {route.kind === "home" && !nav.error && <HomePage />}
      {editorReady && <div className="editor-route" hidden={!activeEditor} inert={!activeEditor || nav.loading}>
        <Workspace active={activeEditor} />
      </div>}
      {activeEditor && !editorReady && <main className="route-state" role="status">
        <p>{t(fontError ? "route.fontError" : "app.opening")}</p>
        {fontError && <Button action="retry-fonts" onClick={() => { setFontError(false); void ensureEditorFonts().then(() => setEditorReady(true), () => setFontError(true)); }}>{t("route.retry")}</Button>}
      </main>}
      {nav.error && <main className="route-state" role="alert"><h1>{t("route.openFailed")}</h1><p>{nav.error}</p>
        <div className="empty-actions"><Button action="retry-route" onClick={() => void navigate(nav.path, { replace: true })}>{t("route.retry")}</Button>
          <Button action="route-home" onClick={() => void navigate("/")}>{t("toolbar.home")}</Button>
          <Button action="route-create" onClick={() => void newProject().catch(error => useNavigation.setState({ error: String(error) }))}>{t("toolbar.newProject")}</Button></div>
      </main>}
      {nav.notice && <div className="navigation-notice" role="status">{nav.notice}<Button action="dismiss-navigation-notice" variant="quiet" onClick={() => useNavigation.setState({ notice: null })}>{t("a11y.close")}</Button></div>}
      <FileInputs />
      <Dialogs />
      <Onboarding open={state.dialog === "onboarding"} />
      {state.confirmed && <GuidedDialog key={state.projectId} document={state.confirmed.document} open={state.dialog === "guided"} />}
      {route.kind === "home" && <div className="sr-only" aria-live="polite">{state.liveMessage}</div>}
    </Tooltip.Provider>
  );
}
