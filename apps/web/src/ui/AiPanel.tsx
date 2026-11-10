import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AIHistoryTurn, PromptPreset } from "@panelstudio/contracts";
import { api } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { labelName, proposalChanges, type ProposalChange } from "../model/changes";
import { localizedSummary } from "../model/chrome";
import { acceptCandidate, sendAiPrompt } from "../state/session";
import { activeScope, cancelAiPrompt, continueEditing, dismissCandidates, openHistoryTurn, refreshAiHistory, selectCandidate, setPrompt, setScope } from "../state/candidate-session";
import { useWorkspace } from "../state/store";
import { candidatesStale } from "../state/types";
import { Button } from "./widgets";

const PRESETS = "panelstudio.presets";
function savedPresets(): PromptPreset[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(PRESETS) ?? "[]");
    return Array.isArray(items) ? items.filter((p): p is PromptPreset => p && typeof p.prompt === "string" && typeof p.id === "string") : [];
  } catch { return []; }
}

function changeLine(t: ReturnType<typeof useTranslation>["t"], line: ProposalChange) {
  if (line.kind === "lock") return t(line.locked ? "ai.changeLock" : "ai.changeUnlock", { label: line.label });
  const key = { canvas: "changeCanvas", gutter: "changeGutter", labels: "changeLabels", move: "changeMove", size: "changeSize", text: "renumber",
    style: "changeStyle", labelPosition: "changeLabelPosition", labelVisibility: "changeLabelVisibility", layoutSettings: "changeLayoutSettings", canvasSettings: "changeCanvasSettings" }[line.kind];
  return t(`ai.${key}`, { ...line });
}
export function AiPanel() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const provider = useQuery({ queryKey: ["ai-provider"], queryFn: () => api.providerSettings() });
  const configured = Boolean(provider.data?.hasSecret && provider.data.config);
  const imageInput = provider.data?.config?.capabilities.imageInput === true;
  const [includePreview, setIncludePreview] = useState(false);
  const [review, setReview] = useState(false);
  const [presets, setPresets] = useState(savedPresets);
  const input = useRef<HTMLTextAreaElement>(null);
  const frozen = activeScope(state);
  const card = state.cards.find((c) => c.candidate.id === state.activeCandidateId);
  const parent = card?.candidate;
  const scopeDoc = parent?.previewDocument ?? state.candidateRoot?.document ?? state.confirmed?.document;
  const scopeNames = scopeDoc ? frozen.selectedPanelIds.map((id) => labelName(scopeDoc, id)).filter(Boolean).join(" · ") : "";
  const running = state.aiStatus.phase === "running";
  const stale = candidatesStale(state) || Boolean(state.awaitingAnswer && state.awaitingAnswer.baseRevision !== state.confirmed?.revision);
  const clarification = state.awaitingAnswer;
  const changes = parent && state.candidateRoot ? proposalChanges(state.candidateRoot.document, parent.previewDocument) : [];
  const prompt = state.aiPrompt;
  const reason = !configured ? t("ai.notConfigured") : running ? t("ai.running") : !prompt.trim() ? t("ai.prompt") :
    frozen.scope === "selection" && !frozen.selectedPanelIds.length ? t("reason.empty-selection") : undefined;
  const send = (fromCurrent: boolean) => {
    if (!reason) void sendAiPrompt(prompt, { includePreviewImage: imageInput && includePreview, visualReview: imageInput && review, fromCurrent });
  };
  const turnStale = (turn: AIHistoryTurn) => turn.isStale || turn.baseRevision !== state.confirmed?.revision;
  const examples = frozen.scope === "selection" ? ["row", "equal", "selectedStyle", "offset", "spacing", "lowercase"]
    : parent ? ["offset", "lowercase", "move", "row", "equal", "selectedStyle"] : ["move", "lowercase", "hero", "row", "equal", "selectedStyle"];
  return <section className="section ai-panel" data-testid="ai-panel">
    <div className="ai-scope">
      <label className="field"><span>{t("ai.scope")}</span><select data-testid="ai-scope" value={frozen.scope} disabled={running || Boolean(clarification && !stale)}
        onChange={(e) => setScope(e.target.value === "selection" ? "selection" : "document")}>
        <option value="document">{t("ai.document")}</option><option value="selection">{t("ai.selection")}</option>
      </select></label>
      <p>{frozen.scope === "document" ? t("ai.scopeAll", { count: scopeDoc?.panelOrder.length ?? 0 }) : scopeNames ? t("ai.scopeSelection", { labels: scopeNames }) : t("reason.empty-selection")}</p>
      {parent && frozen.scope === "selection" && !running && !clarification && !stale ?
        <Button action="use-current-selection" variant="quiet" onClick={() => setScope("selection")}>{t("ai.updateSelection")}</Button> : null}
    </div>
    {state.aiHistory.length ? <ol className="ai-timeline" aria-label={t("ai.history")}>
      {[...state.aiHistory].reverse().map((turn) => {
        const current = parent?.sourceJobId === turn.jobId;
        const historic = turnStale(turn);
        return <li key={turn.jobId} data-testid="ai-turn" data-current={current}>
          <p>{turn.prompt}</p>
          {turn.result?.kind === "clarification" ? <p className="muted">{turn.result.question}</p>
            : turn.result?.kind === "unsupported" ? <p className="muted">{turn.result.reason}</p>
            : turn.result?.kind === "candidates" && turn.result.summary ? <p className="muted">{localizedSummary(turn.result.summary, state.locale)}</p>
            : current ? <p className="muted">{parent?.summary}</p> : <small>{t(`ai.turn.${turn.status}`)}</small>}
          {historic ? <small>{t("ai.historical", { revision: turn.baseRevision })}</small> : null}
          {turn.result?.kind === "candidates" && !current ?
            <Button action="open-history-draft" variant="quiet" disabled={running} onClick={() => void openHistoryTurn(turn)}>{t("ai.viewDraft")}</Button> : null}
          {!historic && turn.result?.kind === "clarification" && turn.jobId !== clarification?.jobId ?
            <Button action="open-history-question" variant="quiet" disabled={running} onClick={() => void openHistoryTurn(turn)}>{t("ai.answer")}</Button> : null}
        </li>;
      })}
    </ol> : null}
    {state.historyCursor ? <Button action="ai-older" onClick={() => void refreshAiHistory(false, state.historyCursor!)}>{t("ai.older")}</Button> : null}
    {!configured ? <p data-testid="ai-status">{t("ai.notConfigured")}</p> : null}
    {state.aiStatus.phase === "running" ? <div role="status" className="ai-progress" data-testid="ai-status"><strong>{state.aiStatus.label}</strong><p>{state.aiStatus.prompt}</p></div> : null}
    {state.aiStatus.phase === "failed" ? <p role="status" data-testid="ai-status">{state.aiStatus.message}</p> : null}
    {state.aiStatus.phase === "cancelled" ? <p role="status" data-testid="ai-status">{t("ai.cancelled")}</p> : null}
    {state.aiStatus.phase === "unsupported" ? <p role="status" data-testid="ai-status">{state.aiStatus.reason}</p> : null}
    {clarification && !running ? <div className="ai-question" data-testid="ai-question">
      <p>{clarification.question}</p>
      {clarification.options.map((option) => <Button key={option} action="ai-option" disabled={stale} onClick={() => { setPrompt(option); input.current?.focus(); }}>{option}</Button>)}
    </div> : null}
    {parent ? <div className="ai-preview" data-testid="ai-proposal">
      <h2>{t("ai.wholeDraft")}</h2>
      <p data-testid="ai-summary">{localizedSummary(parent.summary, state.locale)}</p>
      {changes.length ? <ul className="change-list">{changes.map((line, i) => <li key={i} data-testid="ai-change">{changeLine(t, line)}</li>)}</ul> : null}
      {parent.diagnostics.map((d, i) => <p className="muted" key={i}>{formatDiagnostic(t, d)}</p>)}
      <div className="compare-tabs" aria-label={t("ai.compare")}>
        <Button action="compare-original" aria-pressed={state.compareMode === "original"} onClick={() => selectCandidate(parent.id, "original")}>{t("ai.original")}</Button>
        <Button action="compare-draft" aria-pressed={state.compareMode === "draft"} onClick={() => selectCandidate(parent.id, "draft")}>{t("ai.draft")}</Button>
      </div>
      <Button action="ai-apply" variant="primary" disabledReason={stale ? t("ai.stale") : running ? t("ai.running") : undefined} onClick={() => void acceptCandidate()}>{t("ai.apply")}</Button>
      <div className="ai-actions">
        <Button action="ai-refine" disabled={running || stale} onClick={() => { setPrompt(""); input.current?.focus(); }}>{t("ai.refine")}</Button>
        <Button action="ai-manual" onClick={continueEditing}>{t("layout.manual")}</Button>
        <Button action="ai-discard" disabled={running} onClick={dismissCandidates}>{t("ai.discard")}</Button>
      </div>
    </div> : null}
    {stale ? <p className="ai-warning">{t("ai.stale")}</p> : null}
    <div className="ai-composer">
    <label className="field"><span>{clarification && !stale ? t("ai.answer") : t("ai.prompt")}</span>
      <textarea ref={input} data-testid="ai-prompt" rows={3} maxLength={4000} value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); send(stale); } }} />
    </label>
    {imageInput ? <>
      <label className="check"><input type="checkbox" checked={includePreview} onChange={(e) => setIncludePreview(e.target.checked)} />{t("ai.previewImage")}</label>
      <label className="check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} />{t("ai.review")}</label>
    </> : configured ? <p className="muted">{t("ai.textOnly")}</p> : null}
    {running ? <Button action="ai-cancel" onClick={() => void cancelAiPrompt()}>{t("ai.cancel")}</Button> :
      <Button variant="primary" action={stale ? "ai-regenerate" : "ai-send"} disabledReason={reason} onClick={() => send(stale)}>{t(stale ? "ai.regenerate" : state.aiStatus.phase === "failed" ? "ai.retry" : "ai.send")}</Button>}
    </div>
    <div className="ai-examples"><h2>{t("ai.examplesShort")}</h2>
      {examples.slice(0, 3).map((key) => <Button key={key} action="fill-example" variant="quiet" onClick={() => setPrompt(t(`example.${key}`))}>{t(`example.${key}`)}</Button>)}
      <details><summary>{t("ai.more")}</summary>
        {examples.slice(3).map((key) => <Button key={key} action="fill-example" variant="quiet" onClick={() => setPrompt(t(`example.${key}`))}>{t(`example.${key}`)}</Button>)}
        {["compact","hero","labels"].map((key) => <Button key={key} action="use-builtin" variant="quiet" onClick={() => setPrompt(t(`example.preset.${key}`))}>{t(`preset.${key}`)}</Button>)}
        <Button action="save-preset" disabled={!prompt.trim()} onClick={() => {
          const next: PromptPreset[] = [...presets, { id: crypto.randomUUID(), title: prompt.slice(0, 24), prompt, scope: frozen.scope === "selection" ? "selection" : "all" }];
          setPresets(next); localStorage.setItem(PRESETS, JSON.stringify(next));
        }}>{t("ai.preset")}</Button>
        {presets.map((p) => <Button key={p.id} action="use-preset" onClick={() => setPrompt(p.prompt)}>{p.title}</Button>)}
      </details>
    </div>
  </section>;
}
