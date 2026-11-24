import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../model/feedback";
import { parseRoute, useNavigation } from "../navigation";
import { openSample } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { useWish } from "../state/wish-session";
import { Shell } from "./Dialogs";
import { markOnboardingSeen } from "./onboarding-preference";
import { Button, Icon } from "./widgets";

export function Onboarding({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inEditor = useNavigation(state => parseRoute(state.path).kind === "editor");
  const hasProject = useWorkspace(state => Boolean(state.projectId)) && inEditor;
  useLayoutEffect(() => {
    if (!open) return;
    const { confirmed, projectId, compareMode } = useWorkspace.getState();
    const wish = useWish.getState();
    const hasPanels = inEditor && Boolean(confirmed?.document.panelOrder.length);
    const phase = inEditor && wish.projectId === projectId ? wish.phase : null;
    setStep(hasPanels && compareMode === "editing" && phase === "editing" ? 2 : hasPanels || phase === "select" ? 1 : 0);
    setError("");
  }, [open, inEditor]);
  function close() { markOnboardingSeen(); patch({ dialog: null }); }
  async function sample() {
    setBusy(true); setError("");
    try {
      // openSample creates a project. Never add tutorial assets to an existing figure.
      await openSample();
      markOnboardingSeen();
      patch({ ...(useWorkspace.getState().dialog === "onboarding" ? { dialog: null } : {}), liveMessage: t("onboarding.sampleReady") });
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <Shell open={open} title={t("onboarding.title")} className="onboarding-dialog" onClose={close}>
    <ol className="onboarding-steps" aria-label={t("onboarding.progress")}>
      {["import", "arrange", "finish"].map((key, index) => <li key={key} aria-current={step === index ? "step" : undefined} data-done={step > index}>
        <button type="button" onClick={() => setStep(index)}><span>{step > index ? <Icon name="check" /> : index + 1}</span>{t("onboarding.step." + key)}</button>
      </li>)}
    </ol>
    <div className="onboarding-scene" data-step={step} aria-hidden="true">
      {step === 0 ? <><div className="tour-source-stack"><MiniFigure variant="scatter" /><MiniFigure variant="bars" /><MiniFigure variant="line" /></div>
        <Icon name="arrowRight" /><div className="tour-board"><MiniFigure variant="line" /><MiniFigure variant="bars" /><MiniFigure variant="scatter" /></div></>
        : step === 1 ? <><div className="tour-conversation"><span><Icon name="chat" />{t("onboarding.demoPrompt")}</span><div><Icon name="spark" /><i /><i /></div></div>
          <div className="tour-board arranged"><MiniFigure variant="line" /><MiniFigure variant="bars" /><MiniFigure variant="scatter" /></div></>
        : <><div className="tour-board arranged"><MiniFigure variant="line" /><MiniFigure variant="bars" /><MiniFigure variant="scatter" /></div>
          <Icon name="arrowRight" /><div className="tour-export"><Icon name="check" /><strong>SVG</strong><span>PNG · .figurezip</span></div></>}
    </div>
    <div className="onboarding-copy" aria-live="polite" aria-atomic="true">
      <h3>{t("onboarding.heading." + step)}</h3><p>{t("onboarding.body." + step)}</p>
      {step === 1 && <p className="onboarding-note">{t("onboarding.aiNote")}</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="onboarding-actions">
      <Button action="skip-onboarding" variant="quiet" onClick={close}>{t("onboarding.skip")}</Button>
      <div>
        {step > 0 && <Button action="onboarding-back" variant="quiet" onClick={() => setStep(step - 1)}>{t("onboarding.back")}</Button>}
        {step < 2 ? <Button action="onboarding-next" variant="primary" onClick={() => setStep(step + 1)}>{t("onboarding.next")}<Icon name="arrowRight" /></Button>
          : hasProject ? <Button action="onboarding-done" variant="primary" onClick={close}>{t("onboarding.done")}</Button>
          : <Button action="onboarding-sample" variant="primary" disabled={busy} onClick={() => void sample()}>{t(busy ? "app.opening" : "onboarding.trySample")}<Icon name="arrowRight" /></Button>}
      </div>
    </div>
  </Shell>;
}

function MiniFigure({ variant }: { variant: "bars" | "line" | "scatter" }) {
  return <svg className={"mini-figure " + variant} viewBox="0 0 100 72" fill="none">
    <path d="M16 12v46h72" stroke="currentColor" opacity=".3" />
    {variant === "bars" ? <><path d="M28 58V35M45 58V23M62 58V39M79 58V16" stroke="currentColor" strokeWidth="10" opacity=".65" /></>
      : variant === "line" ? <><path d="m19 49 16-7 14 3 13-19 22-7" stroke="currentColor" strokeWidth="2.5" /><path d="m19 53 16-2 14-7 13 2 22-9" stroke="currentColor" strokeWidth="2" opacity=".4" /></>
      : <>{[[27,42],[32,37],[38,46],[35,33],[45,40],[51,29],[55,36],[59,25],[69,30],[76,22],[71,18],[81,27]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="3" fill="currentColor" opacity={.35 + i % 3 * .2} />)}</>}
  </svg>;
}
