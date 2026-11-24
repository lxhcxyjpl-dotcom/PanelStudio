import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Asset, FigureDocumentV1, FigurePick } from "@panelstudio/contracts";
import { thumbnailUrl } from "../api/client";
import { labelName } from "../model/changes";
import { errorText } from "../model/feedback";
import { Shell } from "./DialogShell";
import { Button, Icon } from "./widgets";

type NumberedAsset = { asset: Asset; number: number };
type Props = {
  project: string;
  document: FigureDocumentV1;
  assets: Asset[];
  supplementary: FigurePick[];
  suggestedSupplementary?: FigurePick[];
  reasons: Record<string, string>;
  summary: string;
  onClose: () => void;
  onSwap: (panelId: string, assetId: string) => Promise<void>;
};

function FigureTile({ project, entry, label, reason, children }: {
  project: string;
  entry: NumberedAsset;
  label?: string;
  reason?: string;
  children?: ReactNode;
}) {
  return <>
    <img src={thumbnailUrl(project, entry.asset.id)} alt="" />
    <span className="curation-file" title={entry.asset.originalFilename}>
      <small>{label ?? "#" + entry.number}</small> {entry.asset.originalFilename}
    </span>
    {reason && <p>{reason}</p>}
    {children}
  </>;
}

export function CurationReview({ project, document, assets, supplementary, suggestedSupplementary, reasons, summary, onClose, onSwap }: Props) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const entries = assets.map((asset, index) => ({asset,number:index + 1}));
  const main = document.panelOrder.flatMap(id => {
    const entry = entries.find(item => item.asset.id === document.panels[id]?.assetId);
    return entry ? [{id,entry,label:labelName(document,id)}] : [];
  });
  const used = new Set(main.map(panel => panel.entry.asset.id));
  const suggestions = new Map(suggestedSupplementary?.map(pick => [pick.id, pick.reason]));
  const supplements = supplementary.flatMap(pick => {
    const entry = entries.find(item => item.asset.id === pick.id && !used.has(pick.id));
    return entry ? [{entry,reason:pick.reason}] : [];
  });
  const reserved = new Set(supplements.map(item => item.entry.asset.id));
  const available = entries.filter(item => !used.has(item.asset.id) && !reserved.has(item.asset.id));
  const replacing = main.find(panel => panel.id === target);
  const canReplace = Boolean(supplements.length || available.length);

  async function choose(assetId: string) {
    if (!replacing || saving) return;
    setError("");
    setSaving(true);
    try {
      await onSwap(replacing.id,assetId);
      onClose();
    } catch (cause) {
      setError(errorText(cause));
      setSaving(false);
    }
  }

  const candidates = (items: { entry:NumberedAsset; reason?:string }[]) => (
    <div className="curation-grid">{items.map(({entry,reason}) => replacing
      ? <button type="button" key={entry.asset.id} className="curation-tile" data-action="curation-replacement"
          data-curation-asset={entry.asset.id} disabled={saving} onClick={() => void choose(entry.asset.id)}
          aria-label={t("wish.replaceWith", { name:entry.asset.originalFilename })}>
          <FigureTile project={project} entry={entry} reason={reason} />
        </button>
      : <div key={entry.asset.id} className="curation-tile" data-curation-supplement={entry.asset.id}>
          <FigureTile project={project} entry={entry} reason={reason} />
        </div>)}
    </div>
  );

  return <Shell open title={t("wish.curationReview")} onClose={onClose} className="curation-dialog">
    <div className="curation-body" aria-busy={saving}>
      {replacing ? <div className="curation-heading">
        <Button action="curation-back" variant="quiet" onClick={() => {setTarget(null);setError("");}} disabled={saving}>
          <Icon name="chevron" />{t("wish.curationBack")}
        </Button>
        <h3>{t("wish.replacePanel", {panel:replacing.label})}</h3>
      </div> : <>
        {summary && <p className="curation-summary">{summary}</p>}
        <h3>{t("wish.mainFigures", {count:main.length})}</h3>
        <div className="curation-grid">
          {main.map(({id,entry,label}) => <div className="curation-tile" key={id} data-curation-main={entry.asset.id}>
            <FigureTile project={project} entry={entry} label={label} reason={reasons[entry.asset.id]}>
              {suggestions.has(entry.asset.id) && <p data-curation-suggestion={entry.asset.id}>
                {t("wish.suggestSupplementary", { reason: suggestions.get(entry.asset.id) })}
              </p>}
            </FigureTile>
            {canReplace && <Button action="curation-swap" variant="quiet" title={t("wish.replacePanel", {panel:label})}
              aria-label={t("wish.replacePanel", {panel:label})} onClick={() => setTarget(id)}>
              {t("wish.swapPanel")}
            </Button>}
          </div>)}
        </div>
      </>}
      {supplements.length > 0 && <>
        <h3>{t("wish.supplementaryFigures", {count:supplements.length})}</h3>
        {candidates(supplements)}
      </>}
      {replacing && available.length > 0 && <>
        <h3>{t("wish.otherCandidates")}</h3>
        {candidates(available.map(entry => ({entry})))}
      </>}
      {saving && <p className="curation-summary" role="status">{t("wish.draftingCuration")}</p>}
      {error && <p className="opening-error" role="alert">{error}</p>}
    </div>
  </Shell>;
}
