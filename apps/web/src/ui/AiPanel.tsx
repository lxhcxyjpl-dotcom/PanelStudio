import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AIHistoryTurn, PromptPreset } from "@panelstudio/contracts";
import { api } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { labelName, proposalChanges, unchangedPanelCount, type ProposalChange } from "../model/changes";
import { localizedSummary } from "../model/chrome";
import { acceptCandidate, sendAiPrompt } from "../state/session";
import { activeScope, cancelAiPrompt, continueEditing, dismissCandidates, openHistoryTurn, refreshAiHistory, selectCandidate, setPrompt, setScope } from "../state/candidate-session";
import { patch, useWorkspace } from "../state/store";
import { candidatesStale } from "../state/types";
import { Button, Icon } from "./widgets";

const PRESETS = "panelstudio.presets";
function savedPresets(): PromptPreset[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(PRESETS) ?? "[]");
    return Array.isArray(items) ? items.filter((p): p is PromptPreset => p && typeof p.prompt === "string" && typeof p.id === "string") : [];
  } catch { return []; }
}
function changeLine(t: ReturnType<typeof useTranslation>["t"], line: ProposalChange) {
  if (line.kind === "lock") return t(line.locked ? "ai.changeLock" : "ai.changeUnlock", { label: line.label });
  if (line.kind === "labelSize" || line.kind === "labelColor") return (line.label ? `${line.label} · ` : "") + t("refine." + line.kind, { ...line });
  if (line.kind === "crop" || line.kind === "order") return t("refine." + line.kind, { ...line });
  const key = { canvas: "changeCanvas", gutter: "changeGutter", labels: "changeLabels", move: "changeMove", size: "changeSize", text: "renumber",
    style: "changeStyle", labelPosition: "changeLabelPosition", labelVisibility: "changeLabelVisibility", layoutSettings: "changeLayoutSettings", canvasSettings: "changeCanvasSettings" }[line.kind];
  return t("ai." + key, { ...line });
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
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const olderPosition = useRef<{ top: number; height: number } | null>(null);
  const frozen = activeScope(state);
  const card = state.cards.find(c => c.candidate.id === state.activeCandidateId);
  const parent = card?.candidate;
  const scopeDoc = parent?.previewDocument ?? state.candidateRoot?.document ?? state.confirmed?.document;
  const brief = scopeDoc?.publicationContext;
  const scopeNames = scopeDoc ? frozen.selectedPanelIds.map(id => labelName(scopeDoc, id)).filter(Boolean).join(" · ") : "";
  const running = state.aiStatus.phase === "running";
  const stale = candidatesStale(state) || Boolean(state.awaitingAnswer && state.awaitingAnswer.baseRevision !== state.confirmed?.revision);
  const clarification = state.awaitingAnswer;
  const changes = parent && state.candidateRoot ? proposalChanges(state.candidateRoot.document, parent.previewDocument) : [];
  const unchanged = parent && state.candidateRoot ? unchangedPanelCount(state.candidateRoot.document, parent.previewDocument) : 0;
  const prompt = state.aiPrompt;
  const reason = !configured ? t("ai.notConfigured") : running ? t("ai.running") : !prompt.trim() ? t("ai.prompt") :
    frozen.scope === "selection" && !frozen.selectedPanelIds.length ? t("reason.empty-selection") : undefined;
  const contentReason = !configured ? t("ai.notConfigured") : !imageInput ? t("ai.visionRequired") : running ? t("ai.running") :
    !scopeDoc || scopeDoc.panelOrder.length < 2 ? t("layout.needPanels") : frozen.scope === "selection" && !frozen.selectedPanelIds.length ? t("reason.empty-selection") : undefined;
  const turnStale = (turn: AIHistoryTurn) => turn.isStale || turn.baseRevision !== state.confirmed?.revision;
  const examples = frozen.scope === "selection" ? ["row", "equal", "selectedStyle", "offset", "spacing", "lowercase"]
    : parent ? ["offset", "lowercase", "move", "row", "equal", "selectedStyle"] : ["move", "lowercase", "hero", "row", "equal", "selectedStyle"];

  function goToEnd() {
    atEnd.current = true; setAwayFromEnd(false);
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }
  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
    if (olderPosition.current) {
      element.scrollTop = olderPosition.current.top + element.scrollHeight - olderPosition.current.height;
      olderPosition.current = null;
    } else if (atEnd.current) element.scrollTop = 0;
  }, [state.aiHistory, state.aiStatus.phase, parent?.id, clarification]);
  const send = (fromCurrent: boolean) => {
    if (!reason) { goToEnd(); void sendAiPrompt(prompt, { includePreviewImage: imageInput && includePreview, visualReview: imageInput && review, fromCurrent }); }
  };
  const fill = (value: string) => { setPrompt(value); input.current?.focus({ preventScroll: true }); };
  const sendLabel = t(stale ? "ai.regenerate" : state.aiStatus.phase === "failed" ? "ai.retry" : "ai.send");
  const empty = !state.aiHistory.length && !parent && !clarification && !running;

  return <section className="section ai-panel" data-testid="ai-panel">
    <div className="refine-scope"><span>{t("refine.scope")}</span><strong>{frozen.scope === "selection" ? scopeNames || t("reason.empty-selection") : t("ai.scopeAll", { count: scopeDoc?.panelOrder.length ?? 0 })}</strong></div>
    <div className="ai-context">
      <Button action="publication-context" variant="quiet" className="ai-brief" onClick={() => patch({ dialog: "publication" })}>
        <span className="ai-brief-icon"><Icon name="sliders" /></span>
        <span><strong>{t("publication.title")}</strong><small>{[brief?.journal, brief?.field].filter(Boolean).join(" · ") || t("ai.briefHint")}</small></span>
        <Icon name="edit" />
      </Button>
      <Button action="ai-content-layout" className="content-layout-action" title={t("ai.contentDisclosure")} disabledReason={contentReason}
        onClick={() => { setIncludePreview(true); goToEnd(); void sendAiPrompt(t("ai.contentPrompt"), { includePreviewImage: true, visualReview: review, fromCurrent: stale }); }}>
        <Icon name="spark" />{t("ai.contentLayout")}<Icon name="arrowRight" />
      </Button>
    </div>
    <div className="ai-thread" ref={thread} data-testid="ai-thread" onScroll={event => {
      const el = event.currentTarget;
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      setAwayFromEnd(!atEnd.current);
    }}>
      {state.historyCursor && <Button action="ai-older" variant="quiet" className="older-turns" onClick={() => {
        if (thread.current) olderPosition.current = { top: thread.current.scrollTop, height: thread.current.scrollHeight };
        const before = state.aiHistory;
        void refreshAiHistory(false, state.historyCursor!).then(() => {
          if (useWorkspace.getState().aiHistory === before) olderPosition.current = null;
        });
      }}>{t("ai.older")}</Button>}
      {empty && <div className="ai-welcome">
        <p>{t("ai.welcomeHint")}</p>
        {!configured ? <div className="ai-connection">
          <p data-testid="ai-status">{provider.isError ? t("ai.connectionError") : t("ai.connectHint")}</p>
          <Button action="ai-settings" onClick={() => patch({ dialog: "ai-settings" })}><Icon name="settings" />{t("ai.connect")}</Button>
        </div> : null}
        <div className="ai-starters">
          {examples.slice(0, 3).map(key => <Button key={key} action="fill-example" variant="quiet" onClick={() => fill(t("example." + key))}>{t("example." + key)}<Icon name="arrowRight" /></Button>)}
        </div>
      </div>}
      {!empty && !configured && <div className="ai-connection"><p data-testid="ai-status">{t("ai.notConfigured")}</p>
        <Button action="ai-settings" onClick={() => patch({ dialog: "ai-settings" })}>{t("ai.connect")}</Button></div>}
      {state.aiStatus.phase === "running" && <div className="ai-progress" role="status" data-testid="ai-status">
        {!state.aiHistory.some(turn => turn.jobId === (state.aiStatus.phase === "running" ? state.aiStatus.jobId : null)) && <div className="chat-user"><p>{state.aiStatus.prompt}</p></div>}
        <span className="assistant-signature"><Icon name="spark" />PanelStudio</span><p className="thinking-label"><span className="thinking-dot" />{state.aiStatus.label}</p>
      </div>}
      {state.aiStatus.phase === "failed" && <p className="ai-notice" role="status" data-testid="ai-status">{state.aiStatus.message}</p>}
      {state.aiStatus.phase === "cancelled" && <p className="ai-notice" role="status" data-testid="ai-status">{t("ai.cancelled")}</p>}
      {state.aiStatus.phase === "unsupported" && <p className="ai-notice" role="status" data-testid="ai-status">{state.aiStatus.reason}</p>}
      {clarification && !running && <div className="ai-question" data-testid="ai-question">
        <p>{clarification.question}</p>
        <div className="answer-options">{clarification.options.map(option => <Button key={option} action="ai-option" disabled={stale} onClick={() => fill(option)}>{option}</Button>)}</div>
      </div>}
      {parent && <div className="ai-preview" data-testid="ai-proposal">
        <div className="draft-heading"><Icon name="sheets" /><h2>{t("ai.proposalTitle")}</h2><span>{t("ai.notApplied")}</span></div>
        <p data-testid="ai-summary">{localizedSummary(parent.summary, state.locale)}</p>
        <div className="compare-tabs" aria-label={t("ai.compare")}>
          <Button action="compare-original" aria-pressed={state.compareMode === "original"} onClick={() => selectCandidate(parent.id, "original")}>{t("ai.original")}</Button>
          <Button action="compare-draft" aria-pressed={state.compareMode === "draft"} onClick={() => selectCandidate(parent.id, "draft")}>{t("ai.draft")}</Button>
        </div>
        <div className="proposal-primary-actions"><Button action="ai-apply" variant="primary" disabledReason={stale ? t("ai.stale") : running ? t("ai.running") : undefined} onClick={() => void acceptCandidate()}><Icon name="check" />{t("ai.apply")}</Button>
          <Button action="ai-discard" variant="quiet" disabled={running} onClick={dismissCandidates}>{t("ai.discard")}</Button></div>
        <div className="draft-details"><ul className="change-list">{changes.map((line, i) => <li key={i} data-testid="ai-change"><span>{changeLine(t, line)}</span>
          {line.kind === "move" && <span className="change-values numeric-text">{line.dx !== 0 && <>X {line.beforeX} → {line.afterX} mm</>}{line.dx !== 0 && line.dy !== 0 && <br />}{line.dy !== 0 && <>Y {line.beforeY} → {line.afterY} mm</>}</span>}
        </li>)}</ul>{!changes.length && <p>{t("refine.noChanges")}</p>}
          {unchanged > 0 && <p className="unchanged-summary">{t("refine.unchanged", { count: unchanged })}</p>}
        </div>
        {parent.diagnostics.map((d, i) => <p className="muted" key={i}>{formatDiagnostic(t, d)}</p>)}
        <div className="ai-actions draft-actions">
          <Button action="ai-refine" variant="quiet" disabled={running || stale} onClick={() => fill("")}>{t("ai.refine")}</Button>
          <Button action="ai-manual" variant="quiet" onClick={continueEditing}>{t("layout.manual")}</Button>
        </div>
      </div>}
      {state.aiHistory.length > 0 && <details className="refine-history"><summary data-action="ai-history-toggle">{t("refine.history")} · {state.aiHistory.length}</summary><ol className="ai-timeline" aria-label={t("ai.history")}>
        {[...state.aiHistory].reverse().map(turn => {
          const current = parent?.sourceJobId === turn.jobId;
          const historic = turnStale(turn);
          const pendingCurrent = state.aiStatus.phase === "running" && state.aiStatus.jobId === turn.jobId;
          return <li key={turn.jobId} data-testid="ai-turn" data-current={current}>
            <div className="chat-user"><span className="sr-only">{t("ai.you")}</span><p>{turn.prompt}</p></div>
            {!pendingCurrent && <div className="chat-assistant">
              <span className="assistant-signature"><Icon name="spark" />PanelStudio</span>
              {turn.result?.kind === "clarification" ? (turn.jobId !== clarification?.jobId && <p>{turn.result.question}</p>)
                : turn.result?.kind === "unsupported" ? <p>{turn.result.reason}</p>
                : turn.result?.kind === "candidates" && turn.result.summary ? <p>{current ? t("ai.draftReady") : localizedSummary(turn.result.summary, state.locale)}</p>
                : <small>{t("ai.turn." + turn.status)}</small>}
              {historic && <small>{t("ai.historical", { revision: turn.baseRevision })}</small>}
              {turn.result?.kind === "candidates" && !current && <Button action="open-history-draft" variant="quiet" disabled={running} onClick={() => { atEnd.current = true; void openHistoryTurn(turn); }}>{t("ai.viewDraft")}<Icon name="arrowRight" /></Button>}
              {!historic && turn.result?.kind === "clarification" && turn.jobId !== clarification?.jobId &&
                <Button action="open-history-question" variant="quiet" disabled={running} onClick={() => void openHistoryTurn(turn)}>{t("ai.answer")}</Button>}
            </div>}
          </li>;
        })}
      </ol></details>}
    </div>
    {awayFromEnd && <Button action="ai-latest" className="latest-message" onClick={goToEnd}><Icon name="import" />{t("ai.latest")}</Button>}
    <div className="ai-compose-dock">
      {stale && <p className="ai-warning" role="status">{t("ai.stale")}</p>}
      <form className="ai-composer" onSubmit={event => { event.preventDefault(); send(stale); }}>
        <label className="field"><span className="sr-only">{clarification && !stale ? t("ai.answer") : t("ai.prompt")}</span>
          <textarea ref={input} data-testid="ai-prompt" rows={3} maxLength={4000} value={prompt}
            placeholder={t(clarification && !stale ? "ai.answerPlaceholder" : parent ? "ai.refinePlaceholder" : "ai.placeholder")}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && (!event.shiftKey || event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); send(stale); }
            }} />
        </label>
        <div className="composer-tools">
          <label className="scope-control" title={scopeNames || t("ai.scopeAll", { count: scopeDoc?.panelOrder.length ?? 0 })}>
            <span className="sr-only">{t("ai.scope")}</span>
            <select data-testid="ai-scope" value={frozen.scope} disabled={running || Boolean(clarification && !stale)}
              onChange={event => setScope(event.target.value === "selection" ? "selection" : "document")}>
              <option value="document">{t("ai.document")}</option><option value="selection">{t("ai.selection")}</option>
            </select>
          </label>
          {imageInput && <label className="vision-chip" data-checked={includePreview} title={t("ai.contentDisclosure")}>
            <input type="checkbox" checked={includePreview} onChange={event => setIncludePreview(event.target.checked)} aria-label={t("ai.previewImage")} />
            <Icon name="image" /><span>{t("ai.attachFigure")}</span>
          </label>}
          {running ? <Button key="cancel" action="ai-cancel" className="round-send" variant="primary" aria-label={t("ai.cancel")} title={t("ai.cancel")}
            onClick={event => { event.preventDefault(); void cancelAiPrompt(); }}><Icon name="stop" /></Button>
            : <Button key="send" type="submit" variant="primary" className="round-send" action={stale ? "ai-regenerate" : "ai-send"} disabledReason={reason} aria-label={sendLabel} title={sendLabel}><Icon name="arrowUp" /></Button>}
        </div>
      </form>
      {frozen.scope === "selection" && <div className="scope-summary"><span>{scopeNames ? t("ai.scopeSelection", { labels: scopeNames }) : t("reason.empty-selection")}</span>
        {parent && !running && !clarification && !stale && <Button action="use-current-selection" variant="quiet" onClick={() => setScope("selection")}>{t("ai.updateSelection")}</Button>}
      </div>}
      {imageInput && (includePreview || review) && <p className="ai-disclosure">{t("ai.imageDisclosure")}</p>}
      <details className="composer-options"><summary><Icon name="sliders" />{t("ai.options")}<Icon name="chevron" /></summary>
        <div className="composer-options-body">
          {imageInput ? <label className="check"><input type="checkbox" checked={review} onChange={event => setReview(event.target.checked)} />{t("ai.review")}</label>
            : configured && <p className="muted">{t("ai.textOnly")}</p>}
          <div className="ai-examples">
            {examples.map(key => <Button key={key} action="fill-example" variant="quiet" onClick={() => fill(t("example." + key))}>{t("example." + key)}</Button>)}
            {["compact", "hero", "labels"].map(key => <Button key={key} action="use-builtin" variant="quiet" onClick={() => fill(t("example.preset." + key))}>{t("preset." + key)}</Button>)}
            <Button action="save-preset" disabled={!prompt.trim()} onClick={() => {
              const next: PromptPreset[] = [...presets, { id: crypto.randomUUID(), title: prompt.slice(0, 24), prompt, scope: frozen.scope === "selection" ? "selection" : "all" }];
              setPresets(next); try { localStorage.setItem(PRESETS, JSON.stringify(next)); } catch { patch({ liveMessage: t("ai.presetStorageError") }); }
            }}>{t("ai.preset")}</Button>
            {presets.map(p => <Button key={p.id} action="use-preset" onClick={() => fill(p.prompt)}>{p.title}</Button>)}
          </div>
        </div>
      </details>
    </div>
  </section>;
}
