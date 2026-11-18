import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "../../state/store";
import { Button, Icon } from "../widgets";
import { copyFor } from "./home-copy";

const slides = [
  { id: "focus", width: 2126, height: 1772 },
  { id: "compare", width: 2126, height: 2173 },
  { id: "story", width: 1134, height: 2669 },
] as const;

function dimensions(element: HTMLElement) {
  return { width: element.clientWidth, height: element.clientHeight };
}

function roleOf(index: number, current: number) {
  const offset = (index - current + slides.length) % slides.length;
  if (offset === 0) return "front";
  return offset === 1 ? "right" : "left";
}

function paperStyle(index: number, current: number, stage: { width: number; height: number }) {
  const front = slides[current]!;
  const paper = slides[index]!;
  const frontRatio = front.width / front.height;
  const ratio = paper.width / paper.height;
  const frontWidth = Math.min(442, stage.width * .58, Math.min(520, stage.height * .85) * frontRatio);
  const role = roleOf(index, current);
  const width = role === "front" ? frontWidth : Math.min(382, stage.width * .48, frontWidth / frontRatio * .92 * ratio);
  const side = role === "left" ? -1 : 1;
  // Each side sheet is centered on the front sheet's edge, leaving roughly half visible.
  return {
    aspectRatio: ratio,
    "--slide-offset": (role === "front" ? 0 : side * frontWidth / 2) + "px",
    "--slide-scale": width / 600,
  } as CSSProperties;
}

export function LayoutCarousel({ suspended }: { suspended: boolean }) {
  const { t, i18n } = useTranslation();
  const copy = copyFor(i18n.language);
  const motion = useWorkspace(state => state.motion);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [inView, setInView] = useState(false);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const reduced = motion === "on" || (motion === "system" && systemReduced);
  const ready = loaded === slides.length;

  useLayoutEffect(() => {
    const element = stage.current!;
    const resize = () => setSize(dimensions(element));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const viewport = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)));
    viewport.observe(element);
    return () => { observer.disconnect(); viewport.disconnect(); };
  }, []);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setSystemReduced(media.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      media.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!ready || reduced || suspended || !playing || !pageVisible || !inView) return;
    const timer = window.setTimeout(() => setCurrent((current + 1) % slides.length), 5000);
    return () => window.clearTimeout(timer);
  }, [current, ready, reduced, suspended, playing, pageVisible, inView]);

  const retry = () => { setFailed(false); setLoaded(0); setAttempt(value => value + 1); };
  return <div className="hero-showcase" data-testid="hero-showcase" data-active={current} data-reduced={reduced}>
    <div className="hero-stage" ref={stage}>
      {slides.map((slide, index) => <button key={slide.id} type="button" className="hero-paper"
        data-role={roleOf(index, current)} data-action="select-layout-paper"
        aria-label={copy.layouts[index]} aria-pressed={current === index} tabIndex={-1}
        style={paperStyle(index, current, size)} onClick={() => setCurrent(index)}>
        <img key={attempt} src={"/hero-layouts/" + slide.id + ".webp" + (attempt ? "?retry=" + attempt : "")}
          width={slide.width} height={slide.height} alt={copy.layouts[index]} draggable={false}
          fetchPriority={index === 0 ? "high" : "auto"} onLoad={() => setLoaded(value => value + 1)} onError={() => setFailed(true)} />
      </button>)}
    </div>
    <div className="hero-controls" role="group" aria-label={t("brand.examples")}>
      <span data-testid="layout-name" className="hero-layout-name">{copy.layouts[current]}</span>
      <div className="hero-pager">
        {slides.map((slide, index) => <button key={slide.id} type="button" data-action="choose-example"
          aria-label={copy.layouts[index]} aria-pressed={index === current} onClick={() => setCurrent(index)} />)}
      </div>
      {!reduced && <Button action="hero-playback" variant="quiet" aria-label={t(playing ? "brand.pause" : "brand.play")}
        title={t(playing ? "brand.pause" : "brand.play")} onClick={() => setPlaying(!playing)}><Icon name={playing ? "pause" : "play"} /></Button>}
    </div>
    {failed && <div className="hero-load-error" role="alert">{copy.unavailable}
      <Button action="retry-hero" variant="quiet" onClick={retry}>{t("route.retry")}</Button>
    </div>}
  </div>;
}
