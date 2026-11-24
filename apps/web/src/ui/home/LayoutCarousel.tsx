import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../widgets";
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

export function LayoutCarousel() {
  const { t, i18n } = useTranslation();
  const copy = copyFor(i18n.language);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    const element = stage.current!;
    const resize = () => setSize(dimensions(element));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const retry = () => { setFailed(false); setAttempt(value => value + 1); };
  return <div className="hero-showcase" data-testid="hero-showcase" data-active={current}>
    <div className="hero-stage" ref={stage}>
      {slides.map((slide, index) => <div key={slide.id} className="hero-paper"
        data-role={roleOf(index, current)} aria-hidden={current !== index}
        style={paperStyle(index, current, size)}>
        <img key={attempt} src={"/hero-layouts/" + slide.id + ".webp" + (attempt ? "?retry=" + attempt : "")}
          width={slide.width} height={slide.height} alt={copy.layouts[index]} draggable={false}
          fetchPriority={index === 0 ? "high" : "auto"} onError={() => setFailed(true)} />
      </div>)}
    </div>
    <div className="hero-controls" role="group" aria-label={t("brand.examples")}>
      {slides.map((slide, index) => <Button key={slide.id} action="choose-example" variant="quiet"
        aria-pressed={index === current} onClick={() => setCurrent(index)}>{copy.layouts[index]}</Button>)}
    </div>
    {failed && <div className="hero-load-error" role="alert">{copy.unavailable}
      <Button action="retry-hero" variant="quiet" onClick={retry}>{t("route.retry")}</Button>
    </div>}
  </div>;
}
