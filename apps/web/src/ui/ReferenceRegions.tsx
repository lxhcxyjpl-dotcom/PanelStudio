import { useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ReferenceSlot } from "@panelstudio/contracts";
import type { NamedUnit } from "../model/guided-preferences";
import type { ReferenceImage, Region } from "../model/reference-image";
import { Button, Icon } from "./widgets";

type Point = { x: number; y: number };
const clamp = (v: number) => Math.min(1, Math.max(0, v));
function rect(p: Point, q: Point): Region {
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) };
}
export function ReferenceRegions({ source, units, slots, change }: {
  source: ReferenceImage; units: NamedUnit[]; slots: ReferenceSlot[]; change: (values: ReferenceSlot[]) => void;
}) {
  const { t } = useTranslation();
  const [edit, setEdit] = useState<number | null>(null);
  const [review, setReview] = useState(slots.length !== units.length);
  const [draft, setDraft] = useState<Region | null>(null);
  const start = useRef<{ point: Point; pointer: number } | null>(null);
  function point(event: PointerEvent<HTMLDivElement>): Point {
    const r = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - r.x) / r.width), y: clamp((event.clientY - r.y) / r.height) };
  }
  function assign(index: number, id: string) {
    const previous = slots[index]!.unitId;
    change(slots.map((s, i) => i === index ? { ...s, unitId: id } :
      id && s.unitId === id ? { ...s, unitId: previous } : s));
  }
  function add(r: Region) {
    if (edit !== null && slots[edit]) {
      change(slots.map((s, i) => i === edit ? { ...s, ...r } : s)); setEdit(null);
    } else if (slots.length < 16) {
      const id = units.find((u) => !slots.some((s) => s.unitId === u.id))?.id ?? "";
      change([...slots, { ...r, unitId: id }]);
      setReview(true);
    }
  }
  function overlay(r: Region) { return { left: r.x * 100 + "%", top: r.y * 100 + "%", width: r.width * 100 + "%", height: r.height * 100 + "%" }; }
  return <>
    <div className="guide-sheet" data-testid="reference-sheet" aria-label={t("layout.reference")} title={t("layout.drawRegions")} style={{ width: "min(100%, " + source.aspect * (review ? 320 : 240) + "px)", aspectRatio: source.aspect }}
      onPointerDown={(e) => {
        if (e.button !== 0 || start.current) return;
        start.current = { point: point(e), pointer: e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => { if (start.current?.pointer === e.pointerId) setDraft(rect(start.current.point, point(e))); }}
      onPointerCancel={() => { start.current = null; setDraft(null); }}
      onPointerUp={(e) => {
        if (start.current?.pointer !== e.pointerId) return;
        const r = rect(start.current.point, point(e)); start.current = null; setDraft(null);
        if (r.width >= 0.018 && r.height >= 0.018) add(r);
      }}>
      <img src={source.preview} alt={source.name} draggable={false} />
      {slots.map((s, i) => <span key={i} className={"guide-box" + (i === edit ? " selected" : "")} style={overlay(s)}>
        <b>{units.find((u) => u.id === s.unitId)?.name ?? i + 1}</b></span>)}
      {draft && <span className="guide-box selected" style={overlay(draft)} />}
    </div>
    {edit !== null && <small role="status">{t("layout.redraw", { index: edit + 1 })}</small>}
    <div className="guide-region-heading">
      <Button action="review-regions" variant="quiet" aria-expanded={review} aria-controls="reference-mappings"
        title={t("layout.reviewMappings")} onClick={() => { setReview(!review); setEdit(null); }}>
        <Icon name="chevron" /><strong>{t("layout.regionCount", { count: slots.length, target: units.length })}</strong>
      </Button>
      <Button action="add-reference-region" variant="quiet" disabled={slots.length >= 16} onClick={() => {
        const id = units.find((u) => !slots.some((s) => s.unitId === u.id))?.id ?? "";
        change([...slots, { x: 0.1, y: 0.1, width: 0.3, height: 0.3, unitId: id }]); setEdit(slots.length); setReview(true);
      }}>{t("layout.addRegion")}</Button>
    </div>
    <ol className="guide-regions" id="reference-mappings" hidden={!review}>{slots.map((s, i) => <li key={i}>
      <div><label><span>{i + 1}</span><select aria-label={t("layout.slotFor", { index: i + 1 })} value={s.unitId} onChange={(e) => assign(i, e.target.value)}>
        <option value="">{t("layout.unassigned")}</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <Button variant="quiet" action="edit-region" aria-pressed={edit === i} onClick={() => setEdit(edit === i ? null : i)}>{t("layout.editRegion")}</Button>
        <Button variant="quiet" action="remove-region" aria-label={t("layout.removeSlot", { index: i + 1 })} onClick={() => {
          change(slots.filter((_, k) => i !== k)); setEdit(null);
        }}>×</Button></div>
      {edit === i && <div className="guide-coordinates">{(["x", "y", "width", "height"] as const).map((key) => <label className="field" key={key}>
        <span>{t("layout.coord." + key)} %</span><input type="number" min={key === "x" || key === "y" ? 0 : 0.1} max={100} step="0.1"
          value={Number((s[key] * 100).toFixed(1))} onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) change(slots.map((slot, k) => k === i ? { ...slot, [key]: clamp(n / 100) } : slot));
          }} /></label>)}</div>}
    </li>)}</ol>
  </>;
}
