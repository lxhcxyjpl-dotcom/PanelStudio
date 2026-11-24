import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RESOURCE_LIMITS } from "@panelstudio/contracts";
import { api, contentUrl, thumbnailUrl } from "../api/client";
import { useDictation } from "./useDictation";
import { EditableMessage } from "./EditableMessage";
import { archivedVersions, revisitOpening } from "../state/opening";
import { editWishMessage, visitVersion } from "../state/edit-message";
import { useVersionLinks, versionChoices } from "../state/message-versions";
import { cancelAiPrompt, commitWish, openListedProject, resizeCanvas, transact } from "../state/session";
import { ChatInput } from "./ChatInput";
import { CurationReview } from "./CurationReview";
import { atLatest, rememberVersionPosition, restoreVersionPosition, type VersionPosition } from "./conversation-scroll";
import { QuestionCard, answerChoices } from "./QuestionCard";
import { publicationFrom, isPendingLayout } from "../model/wish";
import { labelName } from "../model/changes";
import { geometryLocked } from "../model/document-ui";
import { errorText } from "../model/feedback";
import { patch, useWorkspace, useWorkspaceFields } from "../state/store";
import { changeWish, isCurrentWishEdit, lastPublication, useWish } from "../state/wish-session";
import {
  openSelection,
  orderAssets,
  replaceCuratedPanel,
  replacementTarget,
  submitWish,
  stopWishDiscussion,
  swapImage,
  type PendingSwap,
} from "../state/wish";
import { Shell } from "./DialogShell";
import { Button, Icon, NumberField } from "./widgets";
import { FigureIdentityCheck, ReadingDetails, ReadingSwitch } from "./FigureReading";
import { preferredReadingMode } from "../state/reading-preference";
import { WishEditFeedback } from "./WishEditFeedback";
import "./wish.css";

export function WishComposer({ versionPosition }: { versionPosition: RefObject<VersionPosition | null> }) {
  const { t } = useTranslation();
  const [heightDialog, setHeightDialog] = useState<string | null>(null);
  const [heightIssue, setHeightIssue] = useState("");
  const { projectId, confirmed, imports, compareMode, crop, aiStatus, inspectorMode, mode, rightOpen, saveState } =
    useWorkspaceFields(
      "projectId",
      "confirmed",
      "imports",
      "compareMode",
      "crop",
      "aiStatus",
      "inspectorMode",
      "mode",
      "rightOpen",
      "saveState",
    );
  const interacting = useWorkspace(state => state.interaction !== null);
  const w = useWish();
  const links = useVersionLinks(s => s.links);
  const { data } = useQuery({
    queryKey: ["assets", projectId],
    enabled: Boolean(projectId),
    queryFn: () => api.assets(projectId!),
  });
  const replacementPicker = useRef<HTMLInputElement>(null);
  const replacement = useRef<{ panel: string; revision: number } | null>(null);
  const [pendingSwap, setPendingSwap] = useState<PendingSwap | null>(null);
  const [inspected, setInspected] = useState<string | null>(null);
  const [curationProject, setCurationProject] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [away, setAway] = useState(false);
  const questionId = useId(), historyId = useId(), historyLog = useRef<HTMLOListElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const followHistory = useRef(true);
  useLayoutEffect(() => {
    setExpanded(Boolean(versionPosition.current) || useVersionLinks.getState().links.some(link => link.project === projectId));
    followHistory.current = true;
    setAway(false);
  }, [projectId, versionPosition]);
  useLayoutEffect(() => {
    const log = historyLog.current;
    if (!expanded || !log) return;
    const previous = versionPosition.current;
    if (previous && previous.view !== projectId) {
      versionPosition.current = null;
      if (restoreVersionPosition(log, previous)) {
        followHistory.current = atLatest(log);
        setAway(!followHistory.current);
        return;
      }
    }
    if (followHistory.current) log.scrollTop = log.scrollHeight;
  }, [expanded, projectId, versionPosition, w.turns]);
  const assets = orderAssets(data?.items ?? [], w.order);
  const busy = w.busy || imports.some((row) => row.status === "importing") || aiStatus.phase === "running";
  const input = useRef<HTMLTextAreaElement>(null);
  const aiOpen = inspectorMode === "ai" && (mode === "full" || mode === "compact" || rightOpen);
  const { data: provider } = useQuery({ queryKey: ["ai-provider"], queryFn: api.providerSettings, enabled: aiOpen });
  const previewing =
    compareMode !== "editing" ||
    Boolean(crop) ||
    (aiOpen && Boolean(provider?.hasSecret && provider.config));
  const showingCuration = Boolean(projectId && curationProject === projectId);
  const voice = useDictation(input, value => changeWish({ input: value }),
    [projectId, w.phase, w.question?.prompt, w.turns.length].join("|"),
    Boolean(busy || previewing || pendingSwap || w.identity || inspected || showingCuration || !assets.length));
  if (!projectId || !confirmed || !assets.length) return null;
  const inspectedIndex = assets.findIndex((asset) => asset.id === inspected);
  const inspectedAsset = assets[inspectedIndex];
  const note = inspectedAsset ? w.notes[inspectedAsset.id] ?? "" : "";
  const noteForThisRound = inspectedAsset ? w.reviewNotes?.[inspectedAsset.id] ?? "" : "";
  const selecting = w.phase === "select";
  const browseWhileWaiting = selecting && busy;
  const first = w.phase !== "editing";
  const curated = !first && confirmed.document.panelOrder.length ? confirmed.document.curation : null;
  const used = new Set(confirmed.document.panelOrder.map(id => confirmed.document.panels[id]?.assetId));
  const supplementCount = curated?.supplementary.filter(pick => !used.has(pick.id) && assets.some(asset => asset.id === pick.id)).length ?? 0;
  const journal = publicationFrom(
    first ? w.goal : "",
    confirmed.document.publicationContext ?? { ...lastPublication(), message: "", preference: "auto" },
  );
  const target = [journal.journal, journal.field].filter(Boolean).join(" · ");
  const currentReply = w.replyRevision === null || w.replyRevision === confirmed.revision ? w.reply : "";
  const question = currentReply;
  const previousTurns = question && w.turns.at(-1) === "PanelStudio · " + question ? w.turns.slice(0, -1) : w.turns;
  const card = !w.identity && !pendingSwap && !busy ? w.question : null;
  const edit = !first && !busy && !w.identity && !w.question && !pendingSwap && w.projectId === projectId &&
    isCurrentWishEdit(w.editFeedback, confirmed) ? w.editFeedback : null;
  const feedback = question && question !== card?.prompt && !w.editFeedback;
  const showTarget = target && first;
  const stoppable = w.canStopDiscussion || aiStatus.phase === "running";
  const tooMany = t("wish.tooMany", { count: RESOURCE_LIMITS.maxPanelsPerProject });
  const [a, b, ...rest] = confirmed.document.panelOrder;
  const examplePanel = [b, a, ...rest].find(id => id && !geometryLocked(confirmed.document, id));
  const exampleLabel = examplePanel && labelName(confirmed.document, examplePanel);
  function applyNote(assetId: string) {
    const {notes,reviewNotes} = useWish.getState();
    if (reviewNotes) useWish.setState({reviewNotes:{...reviewNotes,[assetId]:notes[assetId] ?? ""}});
  }
  function toggle(id: string) {
    const selected = w.selected.includes(id) ? w.selected.filter((x) => x !== id) : [...w.selected, id];
    if (selected.length > RESOURCE_LIMITS.maxPanelsPerProject) {
      changeWish({ reply: tooMany });
      if (feed.current) feed.current.scrollTop = 0;
      return;
    }
    const rows = w.rows.map(row => row.filter(id => selected.includes(id))).filter(row => row.length);
    if (w.rows.length && selected.includes(id) && !rows.some(row => row.includes(id))) rows.push([id]);
    changeWish({ selected, rows, layoutRecovery: null, reply: "" });
  }
  const autoHeight = confirmed.document.canvas.heightMode === "auto";
  async function adjustLayoutHeight(value: number) {
    setHeightIssue("");
    if (autoHeight) {
      await transact([{type: "layout.setSettings", layoutSettings: {...confirmed!.document.layoutSettings, maxAutoHeightMm: value}}]);
    } else await resizeCanvas("heightMm", value, error => setHeightIssue(errorText(error)));
    const latest = useWorkspace.getState();
    if (latest.projectId !== projectId || !latest.confirmed) return;
    const {canvas, layoutSettings} = latest.confirmed.document;
    if ((autoHeight ? layoutSettings.maxAutoHeightMm : canvas.heightMm) === value) setHeightDialog(null);
    else if (autoHeight) setHeightIssue(latest.liveMessage || t("save.failed"));
  }
  function latest() {
    versionPosition.current = null;
    followHistory.current = true;
    setAway(false);
    if (historyLog.current) historyLog.current.scrollTop = historyLog.current.scrollHeight;
  }
  function submit(text: string, action: "say" | "draft" = "say") {
    voice.cancel();
    latest();
    if (feed.current) feed.current.scrollTop = 0;
    void submitWish(text, action, preferredReadingMode());
  }
  function choosePanels() {
    if (preferredReadingMode() === "thumbnails") submit(t("wish.chooseRequest"));
    else openSelection();
    if (feed.current) feed.current.scrollTop = 0;
  }
  function stop() {
    if (aiStatus.phase === "running") void cancelAiPrompt();
    else stopWishDiscussion();
  }
  function send() {
    if (busy || pendingSwap || w.identity || voice.active) return;
    const panel = !selecting && !first ? replacementTarget(w.input) : false;
    if (panel !== false) {
      if (!panel) {
        changeWish({ reply: t("wish.whichSwap"), editFeedback: null });
        return;
      }
      const match = curated && /#\s*(\d+)/u.exec(w.input);
      if (match) {
        const asset = assets[Number(match[1]) - 1];
        if (!asset || used.has(asset.id)) {
          changeWish({reply:t("wish.pickReplacement"),editFeedback:null});
          return;
        }
        const submitted = w.input;
        void replaceCuratedPanel(panel,asset.id).then(() => {
          if (useWorkspace.getState().projectId === projectId && useWish.getState().input === submitted)
            changeWish({input:""});
        }, cause => {
          if (useWorkspace.getState().projectId === projectId) changeWish({reply:errorText(cause)});
        });
        return;
      }
      replacement.current = { panel, revision: confirmed!.revision };
      replacementPicker.current?.click();
      return;
    }
    if (selecting && !w.input.trim()) return;
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus({ preventScroll: true });
    submit(w.input);
  }
  async function replace(file?: File) {
    const target = replacement.current;
    if (!file || !target || busy) return;
    replacement.current = null;
    const submitted = useWish.getState().input;
    changeWish({ busy: true, editFeedback: null });
    try {
      const pending = await swapImage(file, target.panel, target.revision);
      if (useWorkspace.getState().projectId !== projectId) return;
      setPendingSwap(pending);
      const draft = useWish.getState().input;
      changeWish({ input: draft === submitted ? "" : draft, reply: t(pending ? "wish.fitSwap" : "wish.updated") });
    } catch (error) {
      if (useWorkspace.getState().projectId === projectId) changeWish({ reply: errorText(error) });
    } finally {
      if (useWorkspace.getState().projectId === projectId) changeWish({ busy: false });
    }
  }
  const composer = (
    <form
      className="wish-line"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {w.turns.length > 0 && <button type="button" className="wish-history-toggle" data-action="wish-discussion"
        aria-expanded={expanded} aria-controls={expanded ? historyId : undefined} title={t("wish.discussion")}
        onClick={() => { latest(); setExpanded(value => !value); }}>
        <Icon name="chat"/><span>{t("wish.conversation")}</span>
      </button>}
      <ChatInput
        inputRef={input}
        onSend={send}
        aria-describedby={card ? questionId : undefined}
        rows={1}
        maxLength={1000}
        data-testid="wish-input"
        aria-label={t(card ? "chat.custom" : "wish.start")}
        placeholder={t(
          card
            ? "chat.custom"
            : busy
              ? "chat.nextDraft"
              : selecting
              ? "wish.selectionExample"
              : first
                ? "wish.briefExample"
                : exampleLabel ? "wish.refineExample" : "ai.prompt",
          { panel: exampleLabel },
        )}
        value={w.input}
        onChange={(event) => changeWish({ input: event.target.value })}

      />
      {voice.mic}
      {stoppable ? <Button key="stop" type="button" action="stop-discussion" variant="primary" aria-label={t("chat.stop")} title={t("chat.stop")}
        onClick={() => { stop(); if (window.matchMedia("(pointer: fine)").matches) input.current?.focus({ preventScroll: true }); }}><Icon name="stop"/></Button> :
      <Button key="send"
        action="wish-send"
        type="submit"
        variant="primary"
        disabledReason={
          busy || pendingSwap || voice.active ? t("wish.wait") : !w.input.trim() ? t("wish.typeFirst") : undefined
        }
        title={t("wish.send")}
        aria-label={t("wish.send")}
      >
        <Icon name="arrowUp" />
      </Button>}
      {voice.feedback}
    </form>
  );
  return (
    <section
      className={"wish-workbench" + (selecting ? " choosing" : "")}
      aria-label={t("wish.start")}
      data-testid="wish-workbench"
      aria-busy={busy}
      inert={previewing}
      style={previewing ? { visibility: "hidden" } : undefined}
      onKeyDown={event => {
        if (stoppable && !inspectedAsset && !event.defaultPrevented && event.key === "Escape" &&
          !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !voice.active) {
          event.preventDefault();
          event.stopPropagation();
          stop();
        }
      }}
    >
      <input
        ref={replacementPicker}
        type="file"
        hidden
        accept=".svg,.png,.jpg,.jpeg,.webp"
        onChange={(ev) => {
          const file = ev.target.files?.[0];
          ev.target.value = "";
          void replace(file);
        }}
      />
      {expanded && !w.identity && <div className="wish-thread"><ol id={historyId} className="wish-history" ref={historyLog} aria-label={t("wish.discussion")}
        onScroll={e => { followHistory.current = atLatest(e.currentTarget); setAway(!followHistory.current); }}>
        {previousTurns.map((text, i) => {
          const point = w.checkpoints[i], archive = w.opening, intro = archive?.path.turns[i];
          const assistant = !point && (intro ? intro.role === "assistant" : text.startsWith("PanelStudio · "));
          if (assistant) return <li key={i} className="opening-turn assistant"><div className="opening-message assistant">
            <span className="sr-only">{t("chat.assistant")}</span><p>{text.slice("PanelStudio · ".length)}</p>
          </div></li>;
          const versions = point ? versionChoices(links,point.version) : archive && intro?.version ?
            {variants:archivedVersions(archive,intro.version),current:intro.version.number} : {};
          const group = point?.version.group ?? intro?.version?.group;
          return <li key={projectId + "/" + i} className="opening-turn user" data-version-group={group}><EditableMessage text={text} newFigureVersion={Boolean(point)} disabled={busy}
            {...versions} onEdit={point ? value => editWishMessage(i,value) : archive && intro?.version ?
              value => revisitOpening(archive,archive.path,{index:i,text:value}) : undefined}
            onPick={async id => {
              voice.cancel();
              if (group) versionPosition.current = rememberVersionPosition(historyLog.current, projectId, group);
              if (point) { await visitVersion(id); return; }
              if (!archive) return;
              const dest = [archive.path,...archive.alternatives].find(path => path.pathId === id);
              if (dest?.projectId) await openListedProject(dest.projectId);
              else if (dest) await revisitOpening(archive,dest);
            }}
            onQuote={() => { changeWish({ input:[w.input,text].filter(Boolean).join("\n").slice(0,1000) }); input.current?.focus(); }}/>
          </li>;
        })}
      </ol>
      {away && <button type="button" className="chat-jump" data-action="wish-latest" aria-label={t("ai.latest")} title={t("ai.latest")} onClick={latest}><Icon name="arrowDown"/></button>}
      </div>}
      <div className="wish-feed" ref={feed}>
      {w.identity && (
        <FigureIdentityCheck
          key={w.identity.id}
          item={w.identity}
          project={projectId}
          busy={busy || previewing || Boolean(inspected)}
          onInspect={() => setInspected(w.identity!.id)}
        />
      )}
      {pendingSwap && (
        <div className="wish-choices">
          <Button
            action="confirm-swap"
            onClick={async () => {
              if (pendingSwap.project !== projectId) return;
              setPendingSwap(null);
              changeWish({ busy: true });
              try {
                await commitWish(pendingSwap.revision, [pendingSwap.command]);
                if (useWorkspace.getState().projectId === projectId) changeWish({ reply: t("wish.updated") });
              } catch {
                if (useWorkspace.getState().projectId === projectId) changeWish({ reply: t("wish.changed") });
              } finally {
                if (useWorkspace.getState().projectId === projectId) changeWish({ busy: false });
              }
            }}
          >
            {t("wish.fitNew")}
          </Button>
          <Button
            action="cancel-swap"
            onClick={() => {
              setPendingSwap(null);
              changeWish({ reply: "" });
            }}
          >
            {t("wish.keepOld")}
          </Button>
        </div>
      )}
      {card && (
        <QuestionCard
          promptId={questionId}
          question={card.prompt}
          choices={answerChoices(card.options)}
          disabled={busy}
          compact
          onChoose={submit}
        />
      )}
      {(!w.identity || w.reply) && (edit || feedback || showTarget || curated) && (
          <div className="wish-feedback">
            {edit && <WishEditFeedback key={projectId + "/" + edit.revision} edit={edit} projectId={projectId}
              document={confirmed.document} assets={assets} canUndo={confirmed.history.canUndo && saveState === "saved" && !interacting}/>}
            {feedback && <p role="status">{question}</p>}
            {selecting && w.layoutRecovery && !busy &&
              <Button action="wish-adjust-canvas" variant="quiet" onClick={() => {setHeightIssue(""); setHeightDialog(projectId);}}>
                {t("wish.adjustLayoutCanvas")}
              </Button>}
            {showTarget && (
              <button
                type="button"
                data-action="wish-context"
                onClick={() => patch({ dialog: "publication" })}
              >
                {target}
              </button>
            )}
            {curated && <button type="button" data-action="show-curation" disabled={busy}
              onClick={() => {voice.cancel();setCurationProject(projectId);}}>
              {t("wish.curationCounts", {main:used.size,supplementary:supplementCount})}
            </button>}
          </div>
        )}
      {selecting && (
        <div className="wish-library-heading">
          <strong>{t("wish.pool", { count: assets.length })}</strong>
          <Button
            action="wish-add-files"
            variant="quiet"
            title={t("toolbar.import")}
            aria-label={t("toolbar.import")}
            onClick={() => document.getElementById("import-input")?.click()}
          >
            <Icon name="plus" />
          </Button>
        </div>
      )}
      {curated && showingCuration && (
        <CurationReview key={projectId} project={projectId} document={confirmed.document} assets={assets}
          supplementary={curated.supplementary} suggestedSupplementary={curated.suggestedSupplementary} summary={curated.summary}
          reasons={Object.fromEntries([...curated.main,...curated.supplementary].map(pick => [pick.id,pick.reason]))}
          onClose={() => setCurationProject(null)} onSwap={replaceCuratedPanel} />
      )}
      {selecting && imports.some((row) => row.status === "failed") && (
        <details className="wish-import-errors">
          <summary>
            {t("wish.importErrors", { count: imports.filter((row) => row.status === "failed").length })}
          </summary>
          {imports
            .filter((row) => row.status === "failed")
            .map((row) => (
              <p key={row.id}>
                {row.filename} · {row.message}
              </p>
            ))}
        </details>
      )}
      {selecting && (
        <div className="wish-candidates" aria-label={t("wish.candidates")}>
          {assets.map((asset, i) => {
            const selected = w.selected.includes(asset.id);
            const reason = selected ? w.reasons[asset.id] : undefined;
            const panelId = confirmed.document.panelOrder.find(id => confirmed.document.panels[id]?.assetId === asset.id);
            const label = panelId ? labelName(confirmed.document, panelId) : "";
            return (
              <div className="wish-tile" key={asset.id}>
                <button
                  type="button"
                  data-action={browseWhileWaiting ? "inspect-while-waiting" : "choose-candidate"}
                  data-asset-choice={asset.id}
                  aria-pressed={browseWhileWaiting ? undefined : selected}
                  aria-label={browseWhileWaiting ? t("wish.inspect", { name:asset.originalFilename }) : undefined}
                  title={browseWhileWaiting ? t("wish.inspect", { name:asset.originalFilename }) : w.reasons[asset.id] || w.notes[asset.id] || asset.originalFilename}
                  onClick={() => browseWhileWaiting ? setInspected(asset.id) : toggle(asset.id)}
                >
                  <img src={thumbnailUrl(projectId, asset.id)} alt="" />
                  <span className="wish-tile-copy">
                    <span className="wish-tile-name" title={`#${i + 1} · ${asset.originalFilename}`}><small>{label || "#" + (i + 1)}</small> {asset.originalFilename}</span>
                    {reason && <span className="wish-tile-reason">{reason}</span>}
                  </span>
                  {browseWhileWaiting
                    ? <span className="wish-preview-mark"><Icon name="inspect" /></span>
                    : selected && <Icon name="check" />}
                </button>
                {!browseWhileWaiting && <button
                  type="button"
                  className="wish-zoom"
                  aria-label={t("wish.inspect", { name: asset.originalFilename })}
                  data-action="inspect-candidate"
                  onClick={() => setInspected(asset.id)}
                >
                  <Icon name="inspect" />
                </button>}
              </div>
            );
          })}
        </div>
      )}
      {inspectedAsset && (
        <Shell
          open
          title={inspectedAsset.originalFilename}
          onClose={() => setInspected(null)}
          className="wish-image-dialog"
        >
          {(assets.length > 1 || (curated && !w.identity)) && (
            <div className="wish-preview-bar">
              {assets.length > 1 && <div className="wish-preview-nav" role="group" aria-label={t("wish.reviewImages")}>
                <Button action="wish-preview-previous" variant="quiet" aria-label={t("wish.previousImage")} title={t("wish.previousImage")}
                  disabled={inspectedIndex === 0} onClick={() => setInspected(assets[inspectedIndex - 1]!.id)}>
                  <Icon name="arrowLeft" />
                </Button>
                <span aria-live="polite">{inspectedIndex + 1} / {assets.length}</span>
                <Button action="wish-preview-next" variant="quiet" aria-label={t("wish.nextImage")} title={t("wish.nextImage")}
                  disabled={inspectedIndex === assets.length - 1} onClick={() => setInspected(assets[inspectedIndex + 1]!.id)}>
                  <Icon name="arrowRight" />
                </Button>
              </div>}
              {curated && !w.identity && <Button action="wish-view-first-draft" variant="quiet" onClick={() => setInspected(null)}>
                {t("wish.viewFirstDraft")}<Icon name="arrowRight" />
              </Button>}
            </div>
          )}
          <img src={contentUrl(projectId, inspectedAsset.id)} alt={inspectedAsset.originalFilename} />
          {(!w.reviewNotes || w.readings[inspectedAsset.id]) && <ReadingDetails
            key={inspectedAsset.id}
            assetId={inspectedAsset.id}
            known={w.readings[inspectedAsset.id]}
            onEdit={busy ? undefined : () => setInspected(null)}
          />}
          {w.reasons[inspectedAsset.id] && <p>{w.reasons[inspectedAsset.id]}</p>}
          <div className="wish-preview-note">
            <label className="field">
              <span>{t("wish.note")}</span>
              <input
                maxLength={500}
                value={note}
                onChange={(event) => changeWish({ notes: { ...w.notes, [inspectedAsset.id]: event.target.value } })}
              />
            </label>
            {w.reviewNotes && <Button action="wish-use-note" disabled={note === noteForThisRound}
              onClick={() => applyNote(inspectedAsset.id)}>
              {t(note && note === noteForThisRound ? "wish.noteAddedToDraft" : "wish.noteForDraft")}
            </Button>}
          </div>
        </Shell>
      )}

      </div>
      {heightDialog === projectId && w.layoutRecovery && (
        <Shell open title={t("wish.adjustLayoutCanvas")} onClose={() => setHeightDialog(null)}>
          <NumberField label={t(autoHeight ? "inspector.maxHeight" : "inspector.height") + " (mm)"}
            testId="wish-layout-height" min={0.1} disabled={saveState === "saving"}
            value={autoHeight ? confirmed.document.layoutSettings.maxAutoHeightMm : confirmed.document.canvas.heightMm}
            onCommit={value => void adjustLayoutHeight(value)} />
          {heightIssue && <p role="alert">{heightIssue}</p>}
        </Shell>
      )}
      {!w.identity && <div className="wish-dock">
        <div className="wish-dock-tools">
          {first && (!selecting || w.selected.length > 0) && <div className="wish-choices">
            <Button
              action="wish-draft"
              variant={selecting && !w.input.trim() ? "primary" : "default"}
              disabledReason={
                busy || voice.active ? t("wish.wait") :
                  selecting && w.input.trim() && !isPendingLayout(w.input) ? t("wish.sendFirst") : undefined
              }
              onClick={() => submit(w.input, "draft")}
            >
              {t(selecting ? "wish.usePicked" : w.input.trim() ? "wish.draftFromInput" : "wish.auto", { count: w.selected.length })}
            </Button>
            {!selecting && <Button action="wish-choose" variant="quiet" disabled={busy}
              onClick={choosePanels}>
              {t("wish.choose")}
            </Button>}
          </div>}
          {!first && !selecting && !busy && !edit && !curated && !card && !pendingSwap && assets.length >= 4 &&
            <Button action="wish-choose" variant="quiet" onClick={choosePanels}>
              {t(preferredReadingMode() === "thumbnails" ? "wish.choose" : "wish.adjustSelection")}
            </Button>}
          {(selecting || first || Boolean(w.input)) && <ReadingSwitch disabled={busy} />}
        </div>
        {composer}
      </div>}
    </section>
  );
}
