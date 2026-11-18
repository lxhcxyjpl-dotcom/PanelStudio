import { useTranslation } from "react-i18next";
import { formatDiagnostic } from "../i18n/diagnostic";
import { localizedSummary } from "../model/chrome";
import { labelName, proposalChanges } from "../model/changes";
import { acceptCandidate, assetLookup, continueEditing, dismissCandidates, requestLayout, selectCandidate } from "../state/session";
import { patch, useWorkspaceFields } from "../state/store";
import { candidatesStale } from "../state/types";
import { Button } from "./widgets";

export function ArrangeInspector() {
  const { t, i18n } = useTranslation();
  const state = useWorkspaceFields(
    "cards", "confirmed", "draft", "layoutState", "layoutMessage", "activeCandidateId", "candidateRoot", "cardLayoutRequest",
  );
  const cards = state.layoutState === "idle" ? state.cards : [];
  const stale = cards.length > 0 && candidatesStale(state);
  const applyReason = state.layoutState === "loading" ? t("layout.loading") : !cards.length || !state.activeCandidateId ? t("layout.pick") : stale ? t("layout.stale") : undefined;
  return <section className="section arrange-inspector" aria-label={t("layout.preview")} data-keys="candidates">
    <h2>{t("layout.preview")}</h2>
    {state.layoutState === "loading" && <p role="status">{t("layout.loading")}</p>}
    {state.layoutMessage && <p role="status">{state.layoutMessage}</p>}
    {stale && <p className="task-warning" role="status">{t("layout.stale")}<Button action="regenerate-layout" variant="quiet" onClick={() => void requestLayout(state.cardLayoutRequest ?? { family: "auto" })}>{t("layout.regenerate")}</Button></p>}
    <div className="inspector-task-actions"><Button action="apply-layout" variant="primary" disabledReason={applyReason} onClick={() => void acceptCandidate()}>{t("layout.apply")}</Button>
      <Button action="cancel-layout" variant="quiet" onClick={dismissCandidates}>{t("layout.cancel")}</Button></div>
    <div className="arrange-candidates">{cards.map(card => <button key={card.candidate.id} type="button" data-action="select-candidate" data-testid="candidate-card"
      className={"candidate" + (card.candidate.id === state.activeCandidateId ? " active" : "")} aria-pressed={card.candidate.id === state.activeCandidateId}
      onClick={() => selectCandidate(card.candidate.id)}>
      {card.previewUrl ? <img src={card.previewUrl} alt="" /> : <span className="candidate-placeholder">{card.previewError ?? t("layout.loading")}</span>}
      <span className="candidate-copy"><strong>{localizedSummary(card.candidate.summary, i18n.language)}</strong>
        <span className="numeric-text">{t("layout.canvasSize", { width: round(card.candidate.previewDocument.canvas.widthMm), height: round(card.candidate.previewDocument.canvas.heightMm) })}</span>
        {state.cards.length === 1 && state.candidateRoot && proposalChanges(state.candidateRoot.document, card.candidate.previewDocument).filter(change => change.kind === "size").map(change => <span key={change.label}>{t("ai.changeSize", change)}</span>)}
        {card.candidate.diagnostics.map((item, index) => {
          const id = item.code === "LAYOUT_PPI_BELOW_TARGET" ? item.panelIds?.[0] : undefined;
          const doc = card.candidate.previewDocument;
          const panel = id ? doc.panels[id] : null;
          const name = panel ? assetLookup()(panel.assetId)?.originalFilename ?? panel.name : "";
          return <em key={index}>{id && panel && <>{labelName(doc, id)} · {name} · </>}{formatDiagnostic(t, item)}</em>;
        })}
      </span>
    </button>)}</div>
    <Button action="manual-edit" variant="quiet" onClick={() => { continueEditing(); patch({ inspectorMode: "properties" }); }}>{t("layout.manual")}</Button>
  </section>;
}
function round(n: number) { return Math.round(n * 100) / 100; }
