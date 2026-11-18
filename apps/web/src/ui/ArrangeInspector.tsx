import { useTranslation } from "react-i18next";
import type { FigureDocumentV1 } from "@panelstudio/contracts";
import { formatDiagnostic } from "../i18n/diagnostic";
import { localizedSummary } from "../model/chrome";
import { labelName, proposalChanges } from "../model/changes";
import { acceptCandidate, assetLookup, continueEditing, dismissCandidates, requestLayout, selectCandidate } from "../state/session";
import { patch, useWorkspaceFields } from "../state/store";
import { candidatesStale } from "../state/types";
import { Button, Icon } from "./widgets";

// Name only rows that can actually be seen: a tall panel spanning two bands
// is a mixed composition, not a grid. Work in document mm, not preview pixels.
function alignedRows(doc: FigureDocumentV1): number[] | undefined {
  const frames = doc.panelOrder.map(id => doc.panels[id]!.frameMm).sort((a,b) => a.y - b.y);
  const rows: number[] = [];
  let top = -Infinity, bottom = -Infinity;
  for (const frame of frames) {
    if (frame.y - top > .1) {
      if (frame.y < bottom - .1) return;
      rows.push(1); top = frame.y;
    } else {
      rows[rows.length - 1] = rows[rows.length - 1]! + 1;
    }
    bottom = Math.max(bottom, frame.y + frame.height);
  }
  return rows.length ? rows : undefined;
}

export function ArrangeInspector() {
  const { t, i18n } = useTranslation();
  const state = useWorkspaceFields(
    "cards", "confirmed", "draft", "layoutState", "layoutMessage", "activeCandidateId", "candidateRoot", "cardLayoutRequest",
  );
  const cards = state.layoutState === "idle" ? state.cards : [];
  const stale = cards.length > 0 && candidatesStale(state);
  const applyReason = state.layoutState === "loading" ? t("layout.loading") : !cards.length || !state.activeCandidateId ? t("layout.pick") : stale ? t("layout.stale") : undefined;
  const titleFor = (summary: string, doc: FigureDocumentV1, index: number) => {
    if (summary !== "按排版偏好") return localizedSummary(summary, i18n.language);
    const rows = alignedRows(doc);
    if (!rows) return t("layout.numbered", { number: index + 1 });
    if (rows.length === 1) return t("layout.singleRow", { panels: rows[0] });
    if (rows.every(count => count === rows[0])) return t("layout.evenRows", { rows: rows.length, panels: rows[0] });
    return t("layout.mixedRows", { counts: rows.join(" / ") });
  };
  return <section className="section arrange-inspector" aria-label={t("layout.preview")} data-keys="candidates">
    {state.layoutState === "loading" && <p role="status">{t("layout.loading")}</p>}
    {state.layoutMessage && <p role="status">{state.layoutMessage}</p>}
    <div className="arrange-candidates">{cards.map(({ candidate, previewUrl, previewError }, i) => {
      const selected = candidate.id === state.activeCandidateId, doc = candidate.previewDocument;
      return <button key={candidate.id} type="button" data-action="select-candidate" data-testid="candidate-card"
        className={"candidate" + (selected ? " active" : "")} aria-pressed={selected} onClick={() => selectCandidate(candidate.id)}>
        <span className="candidate-proof">
          {previewUrl ? <img src={previewUrl} alt="" /> : <span className="candidate-placeholder">{previewError ?? t("layout.loading")}</span>}
        </span>
        <span className="candidate-copy"><strong>{titleFor(candidate.summary, doc, i)}</strong>
          <span className="numeric-text">{t("layout.canvasSize", { width: round(doc.canvas.widthMm), height: round(doc.canvas.heightMm) })}</span>
          {cards.length === 1 && state.candidateRoot && proposalChanges(state.candidateRoot.document, doc).filter(change => change.kind === "size").map(change => <span key={change.label}>{t("ai.changeSize", change)}</span>)}
          {candidate.diagnostics.map((item, index) => {
            const id = item.code === "LAYOUT_PPI_BELOW_TARGET" ? item.panelIds?.[0] : undefined;
            const panel = id ? doc.panels[id] : null;
            const filename = panel ? assetLookup()(panel.assetId)?.originalFilename ?? panel.name : "";
            return <em key={index}>{id && panel && <>{labelName(doc, id)} · {filename} · </>}{formatDiagnostic(t, item)}</em>;
          })}
          {selected && <span className="candidate-check"><Icon name="check" /></span>}
        </span>
      </button>;
    })}</div>
    {stale && <p className="task-warning" role="status">{t("layout.stale")}<Button action="regenerate-layout" variant="quiet" onClick={() => void requestLayout(state.cardLayoutRequest ?? { family: "auto" })}>{t("layout.regenerate")}</Button></p>}
    {cards.length > 0 ? <div className="arrange-actions">
      <Button action="apply-layout" variant="primary" disabledReason={applyReason} onClick={() => void acceptCandidate()}>{t("layout.apply")}</Button>
      <Button action="manual-edit" variant="quiet" onClick={() => { continueEditing(); patch({ inspectorMode: "properties", rightOpen: false }); }}>{t("layout.keepAndReturn")}</Button>
      <Button action="cancel-layout" variant="quiet" onClick={dismissCandidates}>{t("layout.discardOptions")}</Button>
    </div> : <Button action="cancel-layout" variant="quiet" onClick={dismissCandidates}>
      {t(state.layoutState === "loading" ? "layout.cancel" : "inspector.returnEditing")}
    </Button>}
  </section>;
}
function round(n: number) { return Math.round(n * 100) / 100; }
