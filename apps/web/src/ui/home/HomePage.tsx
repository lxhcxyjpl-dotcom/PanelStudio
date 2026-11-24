import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { errorText } from "../../model/feedback";
import { duplicateCreationDates } from "../../model/project-identity";
import { navigate } from "../../navigation";
import { readProjectId } from "../../prefs";
import { importPackage, newProject, openListedProject } from "../../state/session";
import { patch, useWorkspace } from "../../state/store";
import { resetOpening, stageFiles, submitOpening, useOpening } from "../../state/opening";
import { WishStart } from "../WishStart";
import { Brand } from "../Brand";
import { Shell } from "../DialogShell";
import { Button, Icon } from "../widgets";
import { CompositionReplay, type ShowcaseExample } from "./FigureReplay";
import { LayoutCarousel } from "./LayoutCarousel";
import { copyFor } from "./home-copy";
import "./home.css";

const docs = "https://github.com/lxhcxyjpl-dotcom/PanelStudio/blob/main/";
const sampleFiles = [
  {url:"/showcase/microscopy-0.png",name:"Blue-micrograph.png"},
  {url:"/showcase/microscopy-1.png",name:"Green-micrograph.png"},
  {url:"/showcase/experimental-1.svg",name:"Quantification.svg"},
];
const galleryHashes = ["#examples", "#laboratory"];

export function HomePage() {
  const { t, i18n } = useTranslation();
  const copy = copyFor(i18n.language);
  const projectId = useWorkspace(state => state.projectId) ?? readProjectId();
  const projectTitle = useWorkspace(state => state.projectId ? state.title : "");
  const chatting = useOpening(s=>s.turns.length>0||Boolean(s.busy));
  const openingBusy=useOpening(s=>s.busy === "upload");
  const hasAttachments=useOpening(s=>s.files.length>0);
  const [dragging,setDragging]=useState(false);
  const dragDepth=useRef(0);
  const [gallery, setGallery] = useState(() => galleryHashes.includes(location.hash));
  const [info, setInfo] = useState<"source" | "about" | null>(() => location.hash === "#about" ? "about" : null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialSection = useRef(location.hash);
  const galleryButton = useRef<HTMLButtonElement>(null);
  const sourceButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sectionHeading = useRef<HTMLHeadingElement>(null);

  const showcase = useQuery({
    queryKey: ["showcase"],
    enabled: gallery,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetch("/showcase/catalog.json");
      if (!response.ok) throw new Error(t("brand.showcaseError"));
      return await response.json() as { examples: ShowcaseExample[] };
    },
  });
  const projects = useQuery({
    queryKey: ["start-projects"],
    enabled: menuOpen,
    queryFn: () => api.projects(),
    refetchOnMount: "always",
  });
  const openProjects = (projects.data?.items ?? []).filter(project => !project.deletedAt);
  const recent = [...openProjects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  const duplicateDates = duplicateCreationDates(openProjects, i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" });
  const examples = showcase.data?.examples ?? [];

  useEffect(() => {
    const syncFragment = () => {
      initialSection.current = location.hash;
      setGallery(galleryHashes.includes(location.hash));
      setInfo(location.hash === "#about" ? "about" : null);
      if (location.hash === "#laboratory") document.getElementById("laboratory")?.scrollIntoView();
    };
    window.addEventListener("hashchange", syncFragment);
    return () => window.removeEventListener("hashchange", syncFragment);
  }, []);
  useEffect(() => {
    if (!gallery) return;
    sectionHeading.current?.focus({ preventScroll: true });
  }, [gallery]);
  useEffect(() => {
    if (gallery && examples.length && initialSection.current === "#laboratory") {
      document.getElementById("laboratory")?.scrollIntoView();
      initialSection.current = "";
    }
  }, [gallery, examples.length]);

  function newOpening(){
    resetOpening();
    requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('[data-testid="start-brief"]')?.focus());
  }
  function closeGallery() {
    setGallery(false);
    setError("");
    if (galleryHashes.includes(location.hash)) history.replaceState(history.state, "", location.pathname + location.search);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => galleryButton.current?.focus());
  }
  function closeInfo() {
    const opener = info === "source" ? sourceButton : menuButton;
    setInfo(null);
    if (location.hash === "#about") history.replaceState(history.state, "", location.pathname + location.search);
    requestAnimationFrame(() => opener.current?.focus());
  }
  async function run(task: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await task(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  async function openExample(example: ShowcaseExample) {
    const response = await fetch(example.exports.project.url);
    if (!response.ok) throw new Error(t("brand.showcaseError"));
    await importPackage(new File([await response.blob()], example.id + ".figurezip", { type: "application/zip" }));
  }

  async function tryWish() {
    const files = await Promise.all(sampleFiles.map(async sample=>{
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error(t("brand.showcaseError"));
      const blob = await response.blob();
      return new File([blob],sample.name,{type:blob.type});
    }));
    const state=useOpening.getState();
    await submitOpening(state.draft.trim() || (state.request?"":t("wish.demoRequest")),true,files);
  }
  return <main className={"brand-page"+(dragging?" chat-dragging":"")} data-testid="home-page"
    onDragEnter={event=>{if(!gallery&&event.dataTransfer.types.includes("Files")){dragDepth.current++;setDragging(true);}}}
    onDragLeave={()=>{dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}}
    onDropCapture={()=>{dragDepth.current=0;setDragging(false);}}
    onDragOver={event=>{if(!gallery && event.dataTransfer.types.includes("Files")) event.preventDefault();}}
    onDrop={event=>{
      if(gallery || !event.dataTransfer.files.length) return;
      event.preventDefault();const files=Array.from(event.dataTransfer.files);
      stageFiles(files);
    }}>
    <div className="brand-container">
      <header className="brand-nav">
        <a href="/" aria-label="PanelStudio" onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (gallery) closeGallery();
        }}><Brand /></a>
        <nav aria-label="PanelStudio">
          {chatting&&!gallery&&<Button action="new-opening" variant="quiet" className="home-nav-icon" disabled={openingBusy} title={t("chat.new")} aria-label={t("chat.new")} onClick={newOpening}><Icon name="edit"/></Button>}
          <button type="button" ref={galleryButton} data-action="home-gallery" className="button quiet home-nav-link"
            aria-label={copy.gallery} title={copy.gallery} aria-pressed={gallery} onClick={() => gallery ? closeGallery() : setGallery(true)}>
            {copy.examples}
          </button>
          <Button action="all-projects" variant="quiet" className="home-nav-link" aria-label={t("brand.allProjects")}
            onClick={() => patch({ dialog: "projects" })}>{copy.projects}</Button>
          <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenu.Trigger asChild><button type="button" ref={menuButton} data-action="home-menu" className="button quiet home-nav-icon" aria-label={copy.menu} title={copy.menu}>
              <svg className="icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14" /></svg>
            </button></DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu home-menu" align="end" sideOffset={6}>
                {chatting&&!gallery&&<DropdownMenu.Item className="menu-item mobile-new-opening" data-action="menu-new-opening" disabled={openingBusy} onSelect={newOpening}>{t("chat.new")}</DropdownMenu.Item>}
                <DropdownMenu.Item className="menu-item" data-action="create-figure" disabled={busy} onSelect={() => void run(() => newProject())}>{t("brand.create")}</DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" data-action="home-open-package" disabled={busy} onSelect={() => document.getElementById("package-input")?.click()}>{t("app.openBundle")}</DropdownMenu.Item>
                <DropdownMenu.Label className="home-menu-label">{t("app.recent")}</DropdownMenu.Label>
                {projects.isError ? <DropdownMenu.Item className="menu-item" data-action="retry-projects" onSelect={event => {
                  event.preventDefault(); void projects.refetch();
                }}>{t("route.offline")} · {t("route.retry")}</DropdownMenu.Item> : recent.map(project => {
                  const creationDate = duplicateDates.get(project.id);
                  return <DropdownMenu.Item key={project.id} className={"menu-item home-recent" + (creationDate ? " same-title" : "")} data-action="open-recent-project" disabled={busy}
                    onSelect={() => void run(() => openListedProject(project.id))}>
                    <span className="home-recent-name">{project.title}</span>
                    <time dateTime={creationDate ? project.createdAt : project.updatedAt}>
                      {creationDate ? t("project.createdAt", { date: creationDate }) : date.format(new Date(project.updatedAt))}
                    </time>
                  </DropdownMenu.Item>;
                })}
                {!recent.length && !projects.isError && <div className="home-menu-note" role="status">{t(projects.isPending ? "app.opening" : "brand.noProjects")}</div>}
                <DropdownMenu.Separator className="home-menu-divider" />
                <DropdownMenu.Item className="menu-item" data-action="settings" onSelect={() => patch({ dialog: "settings" })}>{t("toolbar.settings")}</DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" data-action="open-onboarding" onSelect={() => patch({ dialog: "onboarding" })}>{t("onboarding.title")}</DropdownMenu.Item>
                <DropdownMenu.Item asChild><a className="menu-item" href={docs + "README.md"}>{t("brand.docs")}</a></DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" data-action="home-about" onSelect={() => setInfo("about")}>{t("brand.about")}</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </nav>
      </header>

      {gallery ? <div className="home-gallery" data-testid="home-gallery">
        <div className="gallery-heading"><h1 ref={sectionHeading} tabIndex={-1}>{copy.gallery}</h1>
          <Button action="close-gallery" variant="quiet" onClick={closeGallery}><Icon name="arrowLeft" />{copy.home}</Button></div>
        {showcase.isPending && <p role="status">{t("app.opening")}</p>}
        {showcase.isError && <div role="alert">{t("brand.showcaseError")} <Button action="retry-showcase" onClick={() => void showcase.refetch()}>{t("route.retry")}</Button></div>}
        {examples.length > 0 && <>
          <section className="brand-examples" id="examples" aria-label={t("brand.examples")}>
            <button ref={sourceButton} type="button" className="showcase-caption source-link gallery-source" data-action="home-source" onClick={()=>setInfo("source")}>{copy.source}</button>
            <div className="brand-example-grid">{examples.map(example =>
              <button type="button" key={example.id} className="brand-example-card" data-action="open-scientific-example"
                disabled={busy} onClick={() => void run(() => openExample(example))}
                aria-label={t("brand.openExample") + " · " + t("brand." + example.id)}>
                <span className="brand-example-image">
                  <img src={example.exports.png.url} width="1200" height="800" loading="lazy" alt="" />
                </span>
                <span className="brand-example-heading">{t("brand." + example.id)}<Icon name="arrowRight" /></span>
              </button>
            )}</div>
          </section>
          <LayoutCarousel />
          <CompositionReplay example={examples[0]!} />
        </>}
      </div> : <>
        <section className={"chat-home"+(chatting?" in-conversation":"")} data-testid="home-hero" aria-labelledby="home-title">
          <div className="chat-stage">
            <div className="chat-heading brand-intro"><h1 id="home-title">{t("chat.title")}</h1></div>
            <WishStart fresh/>
            {!chatting&&!hasAttachments&&<div className="chat-shortcuts">
              <button type="button" data-action="wish-demo" title={copy.source} disabled={busy||openingBusy} onClick={()=>void run(tryWish)}><Icon name="image"/>{t("chat.example")}</button>
              {projectId ? <a href="/app" data-action="start-layout" className="brand-resume" title={projectTitle || undefined} onClick={event=>{
                if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
                event.preventDefault();void navigate("/app");
              }}><Icon name="undo"/><span>{projectTitle ? t("wish.resumeNamed", { title: projectTitle }) : t("wish.resume")}</span></a> :
                <button type="button" data-action="start-layout" disabled={busy||openingBusy}
                  onClick={() => void run(() => newProject())}><Icon name="layout"/>{t("wish.blank")}</button>}
            </div>}
          </div>
        </section>
      </>}
      {error && <p className="brand-error" role="alert">{error}</p>}
    </div>
    <Shell open={info !== null} title={info === "source" ? copy.sourceTitle : t("brand.about")} className="home-info" onClose={closeInfo}>
      {info === "source" ? <p>{copy.sourceBody}</p> : <>
        <p>{t("brand.aboutBody")}</p>
        <nav><a href={docs + "docs/format-support.md"}>{t("brand.compatibility")}</a><a href={docs + "docs/licenses.md"}>{t("brand.licenses")}</a><a href="https://github.com/lxhcxyjpl-dotcom/PanelStudio">GitHub</a></nav>
      </>}
    </Shell>
  </main>;
}
