import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "../../state/store";
import { Button, Icon } from "../widgets";

export type RecordedScene = {
  revision: number; documentHash: string; width: number; height: number;
  panels: Array<{ id: string; src: string; frame: { x: number; y: number; width: number; height: number };
    label: null | { text: string; x: number; y: number; size: number; font: string; weight: number; color: string } }>;
};
export type ShowcaseExample = {
  id: string; synthetic: true; replay: string;
  states: { imported: RecordedScene; arranged: RecordedScene; refined: RecordedScene };
  exports: Record<"svg" | "png" | "project", { url: string; sha256: string }>;
};

function usePlayback(element: RefObject<HTMLElement | null>, count: number, milliseconds: number) {
  const motion = useWorkspace(s => s.motion);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const reduced = motion === "on" || (motion === "system" && systemReduced);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(() => reduced ? count - 1 : 0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: .6 });
    if (element.current) observer.observe(element.current);
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", hide);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", hide); };
  }, [element]);
  useEffect(() => {
    if (!visible || !playing || reduced || count < 2) return;
    const timer = window.setTimeout(() => {
      if (step >= count - 1) setPlaying(false);
      else setStep(step + 1);
    }, milliseconds);
    return () => clearTimeout(timer);
  }, [visible, playing, reduced, count, step, milliseconds]);
  const choose = (next: number) => { setPlaying(false); setStep(Math.max(0, Math.min(count - 1, next))); };
  const toggle = () => { if (step === count - 1 && !playing) setStep(0); setPlaying(!playing); };
  return { step, playing: playing && !reduced, reduced, choose, toggle };
}

export function RecordedFigure({ scene, labels = true }: { scene: RecordedScene; labels?: boolean }) {
  return <svg className="recorded-figure" viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label="Synthetic scientific figure"
    data-document-hash={scene.documentHash} data-scene-revision={scene.revision}>
    <rect width={scene.width} height={scene.height} fill="#FFFFFF" />
    {scene.panels.map(panel => <g key={panel.id} className="recorded-panel" style={{ transform: `translate(${panel.frame.x}px,${panel.frame.y}px)` }}>
      <image href={panel.src} width={panel.frame.width} height={panel.frame.height}
        style={{ width: `${panel.frame.width}px`, height: `${panel.frame.height}px` } as CSSProperties} />
    </g>)}
    <g className="recorded-labels" opacity={labels ? 1 : 0}>
      {scene.panels.map(panel => panel.label && <text key={panel.id} x={panel.label.x} y={panel.label.y} fontSize={panel.label.size}
        fontFamily={panel.label.font} fontWeight={panel.label.weight} fill={panel.label.color}>{panel.label.text}</text>)}
    </g>
  </svg>;
}

export function CompositionReplay({ example }: { example: ShowcaseExample }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const playback = usePlayback(ref, 8, 2800);
  const [original, setOriginal] = useState(false);
  const step = playback.step;
  const scene = step < 2 ? example.states.imported : step < 5 || (step === 6 && original) ? example.states.arranged : example.states.refined;
  return <section className="brand-laboratory" ref={ref} id="laboratory" aria-labelledby="lab-heading">
    <h2 id="lab-heading">{t("brand.labTitle")}</h2>
    <div className="replay-layout">
      <div className="replay-stage" data-testid="demo-stage" data-step={step}>
        <div className="replay-paper">{step === 0 ? <div className="replay-sources" data-testid="demo-source-panels">
          {example.states.imported.panels.map(panel => <img key={panel.id} src={panel.src} alt="" />)}
        </div> : <RecordedFigure scene={scene} labels={step >= 3} />}</div>
        {step === 4 && <p className="replay-instruction">{t("brand.demoPrompt")}</p>}
        {step === 6 && <div className="replay-compare"><Button action="demo-original" aria-pressed={original} onClick={() => { playback.choose(6); setOriginal(true); }}>{t("ai.original")}</Button>
          <Button action="demo-draft" aria-pressed={!original} onClick={() => { playback.choose(6); setOriginal(false); }}>{t("ai.draft")}</Button></div>}
      </div>
      <div className="replay-navigation">
        <div className="replay-steps" aria-label={t("brand.play")}>{Array.from({ length: 8 }, (_, index) => <button type="button" key={index}
          data-action="demo-step" aria-current={step === index ? "step" : undefined} onClick={() => playback.choose(index)}>{t("brand.step." + index)}</button>)}</div>
        {!playback.reduced && <div className="replay-buttons">
          <Button variant="quiet" action="demo-playback" onClick={playback.toggle}>
            <Icon name={playback.playing ? "pause" : "play"} />
            {t(playback.playing ? "brand.pause" : step === 7 ? "brand.replay" : "brand.play")}
          </Button>
        </div>}
        <p className="showcase-caption">{t("brand.demoDisclosure")}</p>
        <a className="brand-text-link" href={example.exports.svg.url} download>{t("brand.downloadSvg")}<Icon name="export" /></a>
      </div>
    </div>
  </section>;
}
