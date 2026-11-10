import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FigureDocumentV1, GuidedPreferences, ReferenceSlot } from "@panelstudio/contracts";
import { namedUnits, parsePreferences } from "../model/guided-preferences";
import { readReference, type ReferenceImage } from "../model/reference-image";
import { requestLayout } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { Shell } from "./Dialogs";
import { ReferenceRegions } from "./ReferenceRegions";
import { Button } from "./widgets";

type Choices = Partial<Record<"gap" | "shape" | "focus" | "first" | "second" | "axis", string>>;
function choicesOf(p: GuidedPreferences) {
  return { gap: p.gapMm?.toString() ?? "", shape: p.shape ?? "", focus: p.focus ?? "",
    first: p.pair?.first ?? "", second: p.pair?.second ?? "", axis: p.pair?.axis ?? "any" };
}
export function GuidedDialog({ document, open }: { document: FigureDocumentV1; open: boolean }) {
  const { t } = useTranslation();
  const units = useMemo(() => namedUnits(document), [document]);
  const [words, setWords] = useState(""), [manual, setManual] = useState<Choices>({});
  const [allowPartial, setAllowPartial] = useState(false);
  const [ref, setRef] = useState<ReferenceImage | null>(null), [slots, setSlots] = useState<ReferenceSlot[]>([]);
  const [alternativeSlots, setAlternativeSlots] = useState<ReferenceSlot[]>([]);
  const [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [fileError, setFileError] = useState(false);
  const fileTicket = useRef(0), submitTicket = useRef(0);
  useEffect(() => () => { fileTicket.current++; submitTicket.current++; }, []);
  const parsed = useMemo(() => parsePreferences(words, units), [words, units]);
  const p = parsed.preferences;
  const choices = { ...choicesOf(p), ...manual };
  const { gap, shape, focus, first, second, axis } = choices;
  const preferences: GuidedPreferences = {};
  if (gap) preferences.gapMm = Number(gap);
  if (shape) preferences.shape = shape as GuidedPreferences["shape"];
  if (focus) preferences.focus = focus;
  if (first && second) preferences.pair = { first, second, axis: axis as NonNullable<GuidedPreferences["pair"]>["axis"] };
  const invalidSlots = ref && (slots.length !== units.length || !units.every((u) => slots.some((s) => s.unitId === u.id)) ||
    slots.some((s) => s.width <= 0 || s.height <= 0 || s.x + s.width > 1.000001 || s.y + s.height > 1.000001));
  const problem = fileError ? "layout.fixReference" : units.length < 2 ? "layout.needUnits" :
    invalidSlots ? "reason.reference-slots" : Boolean(first) !== Boolean(second) || (first && first === second) ? "layout.pairIncomplete" :
    parsed.unresolved.length && !allowPartial ? "layout.reviewWords" :
    gap && (!Number.isFinite(Number(gap)) || Number(gap) < 0 || Number(gap) > 30) ? "layout.gapRange" :
    !ref && !Object.keys(preferences).length ? "layout.needGuide" : "";
  function choose(key: keyof Choices, value: string) { setManual((prev) => ({ ...prev, [key]: value })); setError(""); }
  function describe(value: string) {
    const before = choicesOf(p), after = choicesOf(parsePreferences(value, units).preferences);
    setManual((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) =>
      before[key as keyof Choices] === after[key as keyof Choices])));
    setWords(value); setAllowPartial(false); setError("");
  }
  async function load(file: File) {
    const ticket = ++fileTicket.current;
    setReading(true); setError(""); setFileError(false);
    try {
      const source = await readReference(file, units.length);
      if (ticket !== fileTicket.current) return;
      setRef(source); setSlots(source.regions.map((r, i) => ({ ...r, unitId: units[i]?.id ?? "" })));
      setAlternativeSlots((source.alternative ?? []).map((r, i) => ({ ...r, unitId: units[i]?.id ?? "" })));
    } catch {
      if (ticket === fileTicket.current) { setFileError(true); setRef(null); setSlots([]); }
    } finally { if (ticket === fileTicket.current) setReading(false); }
  }
  async function generate() {
    if (problem || reading || busy) return;
    const ticket = ++submitTicket.current;
    setError(""); setBusy(true);
    try {
      const ok = await requestLayout({ family: "guided", preferences, ...(ref ? { referenceAspect: ref.aspect, referenceSlots: slots } : {}) });
      if (ticket !== submitTicket.current || useWorkspace.getState().dialog !== "guided") return;
      if (ok) patch({ dialog: null });
      else setError(useWorkspace.getState().layoutMessage ?? t("layout.stale"));
    } finally { if (ticket === submitTicket.current) setBusy(false); }
  }
  const unitOptions = units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>);
  return <Shell open={open} title={t("layout.guide")} className="guide-dialog" onClose={() => {
    submitTicket.current++; setBusy(false); patch({ dialog: null });
  }}>
    <fieldset className="guide-columns" disabled={busy}>
      <section className="guide-section" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (!busy && e.dataTransfer.files[0]) void load(e.dataTransfer.files[0]);
        }}>
        <h3>{t("layout.reference")}</h3>
        <p>{t("layout.referenceHint")}</p>
        <label className="guide-file">{ref ? ref.name : t("layout.chooseImage")}
          <input data-testid="reference-file" aria-label={t("layout.chooseImage")} type="file" accept=".png,.jpg,.jpeg,.webp,.svg"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f); }} /></label>
        {reading && <p role="status">{t("layout.readReference")}</p>}
        {fileError && <p role="alert">{t("layout.referenceError")}</p>}
        {ref && <>
          {ref.alternative && <label className="field"><span>{t("layout.method")}</span>
            <select value={ref.method} onChange={() => {
              const next = ref.alternative!;
              setRef({ ...ref, regions: next, alternative: ref.regions, method: ref.method === "outlines" ? "gutters" : "outlines" });
              setSlots(alternativeSlots); setAlternativeSlots(slots); setError("");
            }}><option value="outlines">{t("layout.method.outlines")}</option><option value="gutters">{t("layout.method.gutters")}</option></select></label>}
          <ReferenceRegions key={fileTicket.current + ref.method} source={ref} slots={slots} units={units} change={(values) => { setSlots(values); setError(""); }} />
        </>}
        {(ref || fileError) && <Button action="remove-reference" variant="quiet" onClick={() => {
          fileTicket.current++; setRef(null); setSlots([]); setAlternativeSlots([]); setError(""); setReading(false); setFileError(false);
        }}>{t("layout.removeReference")}</Button>}
      </section>
      <section className="guide-section">
        <label className="field"><span className="guide-title">{t("layout.taste")}</span>
          <textarea data-testid="guide-words" maxLength={600} value={words} placeholder={t("layout.tasteExample")}
            onChange={(e) => describe(e.target.value)} /></label>
        <small>{t("layout.preferencesHint")}</small>
        {!!parsed.unresolved.length && <div className="guide-unresolved" role="status">
          <p>{t("layout.unresolved", { text: parsed.unresolved.join(" · ") })}</p>
          <label><input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} /> {t("layout.useRecognized")}</label>
        </div>}
        <div className="guide-controls">
          <label className="field"><span>{t("layout.focus")}</span><select value={focus} onChange={(e) => choose("focus", e.target.value)}>
            <option value="">{t("layout.unspecified")}</option>{unitOptions}</select></label>
          <label className="field"><span>{t("layout.shape")}</span><select value={shape} onChange={(e) => choose("shape", e.target.value)}>
            <option value="">{t("layout.unspecified")}</option>{["wide", "tall", "square"].map((v) => <option value={v} key={v}>{t("layout.shape." + v)}</option>)}</select></label>
          <label className="field"><span>{t("layout.guideGap")}</span><input type="number" min={0} max={30} step={0.5} value={gap}
            placeholder={t("layout.unspecified")} onChange={(e) => choose("gap", e.target.value)} /></label>
        </div>
        <div className="guide-pair"><label className="field"><span>{t("layout.compareFirst")}</span><select value={first} onChange={(e) => choose("first", e.target.value)}>
          <option value="">{t("layout.unspecified")}</option>{unitOptions}</select></label>
          <label className="field"><span>{t("layout.compareSecond")}</span><select value={second} onChange={(e) => choose("second", e.target.value)}>
            <option value="">{t("layout.unspecified")}</option>{unitOptions}</select></label>
          <label className="field"><span>{t("layout.pairAxis")}</span><select disabled={!first && !second} value={axis} onChange={(e) => choose("axis", e.target.value)}>
            {["any", "horizontal", "vertical"].map((v) => <option value={v} key={v}>{t("layout.axis." + v)}</option>)}</select></label></div>
      </section>
    </fieldset>
    <div className="guide-submit">
      <span role={error ? "alert" : "status"}>{error || (problem ? t(problem) : "")}</span>
      <Button action="generate-guided" variant="primary" disabled={!!problem || reading || busy} onClick={() => void generate()}>
        {t(busy ? "layout.guidedBusy" : "layout.guidedGenerate")}</Button>
    </div>
  </Shell>;
}
