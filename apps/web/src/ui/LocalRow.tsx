import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FigureDocumentV1 } from "@panelstudio/contracts";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { boundsOf } from "../model/snap";
import { completePanelIds, orderedUnits } from "../model/document-ui";
import { labelName } from "../model/changes";
import { requestLayout } from "../state/session";
import { Button, NumberField } from "./widgets";

type Sizing = "preserve" | "equal-width" | "equal-height";
export function LocalRow({ document, ids }: { document: FigureDocumentV1; ids: string[] }) {
  const { t } = useTranslation();
  const units = orderedUnits(document, ids);
  const expanded = completePanelIds(document, ids);
  const bounds = boundsOf(expanded.flatMap((id) => {
    const f = document.panels[id]!.frameMm, ink = resolvePanelLabel(document, id)?.bounds;
    return ink ? [f, ink] : [f];
  }));
  const [sizing, setSizing] = useState<Sizing>("preserve");
  const [gap, setGap] = useState(document.layoutSettings.gutterMm.horizontal);
  const [custom, setCustom] = useState(false);
  const [region, setRegion] = useState(bounds ?? { x: 0, y: 0, width: 0, height: 0 });
  if (!bounds) return null;
  const reason = units.length < 2 || units.length > 3 ? t("row.needUnits") : undefined;
  return <div className="local-row" data-testid="local-row">
    <h2>{t("row.title")}</h2>
    <p>{expanded.map((id) => labelName(document, id)).join(" · ")}</p>
    <label className="field"><span>{t("row.sizing")}</span>
      <select data-testid="row-sizing" value={sizing} onChange={(e) => setSizing(e.target.value as Sizing)}>
        {(["preserve", "equal-width", "equal-height"] as const).map((v) => <option value={v} key={v}>{t(`row.${v}`)}</option>)}
      </select>
    </label>
    <NumberField label={t("row.gap")} min={0} value={gap} onCommit={setGap} />
    <label className="check"><input type="checkbox" checked={custom} onChange={(e) => { setCustom(e.target.checked); setRegion(bounds); }} />{t("row.region")}</label>
    {custom ? <div className="row-region">{(["x", "y", "width", "height"] as const).map((key) =>
      <NumberField key={key} label={t(`row.${key}`)} min={["width", "height"].includes(key) ? 0.001 : 0} value={region[key]} onCommit={(n) => setRegion({ ...region, [key]: n })} />)}</div> : null}
    <Button action="selection-row" disabledReason={reason} onClick={() => void requestLayout({
      family: "selection-row", orderedUnitIds: units, sizing, gapMm: gap, ...(custom ? { regionMm: region } : {}),
    })}>{t("row.preview")}</Button>
  </div>;
}
