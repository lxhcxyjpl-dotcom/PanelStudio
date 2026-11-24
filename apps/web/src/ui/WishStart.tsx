import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { editOpening, openingVersionIndex, switchOpening, openingDraft, resetOpening, retryOpening, stageFiles, stopOpening, submitOpening, unstageFile, useOpening } from "../state/opening";
import { useDictation } from "./useDictation";
import { ReadingSwitch } from "./FigureReading";
import { QuestionCard, answerChoices } from "./QuestionCard";
import { EditableMessage } from "./EditableMessage";
import { ChatInput } from "./ChatInput";
import { atLatest, rememberVersionPosition, restoreVersionPosition, type VersionPosition } from "./conversation-scroll";
import { Button, Icon } from "./widgets";
import "./chat.css";

function Attachment({ file, index, disabled }: { file: File; index: number; disabled: boolean }) {
  const { t } = useTranslation(),
    [preview, setPreview] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <li className="chat-file">
      {preview && <img alt="" src={preview} />}
      <span title={file.name}>{file.name}</span>
      <button
        type="button"
        disabled={disabled}
        data-action="remove-attachment"
        aria-label={t("chat.remove", { name: file.name })}
        onClick={() => unstageFile(index)}
      >
        <Icon name="close" />
      </button>
    </li>
  );
}
export function WishStart({ fresh = false }: { fresh?: boolean }) {
  const { t } = useTranslation();
  const state = useOpening(), promptId = useId();
  const picker = useRef<HTMLInputElement>(null), input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLDivElement>(null);
  const follow = useRef(true), [away, setAway] = useState(false);
  const position = useRef<VersionPosition | null>(null);
  const uploading = state.busy === "upload", waiting = state.busy === "reply";
  const versions = useMemo(() => openingVersionIndex(state, state.alternatives), [state.turns, state.pathId, state.alternatives]);
  const last = state.turns.at(-1), activeQuestion = !state.busy && state.question;
  const questionIndex = activeQuestion ? state.turns.findLastIndex(turn => turn.role === "assistant") : -1;
  const voice = useDictation(input, openingDraft, String(state.generation), uploading);
  const arrangeFiles = state.files.length > 0;
  const sendLabel = arrangeFiles ? t("chat.arrangeFiles", { count: state.files.length }) : t("wish.send");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!useOpening.getState().turns.length && window.matchMedia("(pointer: fine)").matches &&
          document.activeElement === document.body && !document.querySelector('[role="dialog"]'))
        input.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const home = input.current?.closest<HTMLElement>(".chat-home");
    if (!viewport || !home) return;
    function resizeViewport() {
      if (viewport!.scale === 1) home!.style.setProperty("--chat-visible-height", viewport!.height + "px");
      else home!.style.removeProperty("--chat-visible-height");
    }
    resizeViewport();
    viewport.addEventListener("resize", resizeViewport);
    return () => { viewport.removeEventListener("resize", resizeViewport); home.style.removeProperty("--chat-visible-height"); };
  }, []);
  function latest() {
    position.current = null;
    follow.current = true; setAway(false);
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }
  function send(text = state.draft, choice = false) {
    if (state.busy || (!choice && voice.active) || (!text.trim() && !state.files.length)) return;
    voice.cancel(); latest();
    if (!choice || window.matchMedia("(pointer: fine)").matches) input.current?.focus({ preventScroll: true });
    void submitOpening(text, fresh, choice ? [] : undefined, choice);
  }
  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const previous = position.current;
    if (previous && previous.view !== state.pathId) {
      position.current = null;
      if (restoreVersionPosition(el, previous)) {
        follow.current = atLatest(el);
        setAway(!follow.current);
        return;
      }
    }
    if (follow.current) el.scrollTop = el.scrollHeight;
  }, [state.pathId, state.turns, state.preview, state.busy, state.question]);
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (follow.current) el.scrollTop = el.scrollHeight;
      else if (el.scrollHeight - el.clientHeight - el.scrollTop < 4) { follow.current = true; setAway(false); }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div className="opening-chat" data-testid="opening-chat" onKeyDown={e => {
    if (waiting && e.key === "Escape" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && !voice.active) {
      e.preventDefault(); e.stopPropagation(); stopOpening();
    }
  }}>
    <div className="opening-thread" hidden={!state.turns.length && !state.busy}>
      <div className="opening-log" ref={log} role="log" aria-live="polite" aria-relevant="additions" aria-label={t("wish.discussion")}
        onScroll={event => {
          const el = event.currentTarget;
          follow.current = atLatest(el);
          setAway(!follow.current);
        }}>
        {state.turns.map((turn, i) => <div className={"opening-turn " + turn.role} data-version-group={turn.version?.group}
          key={turn.version ? turn.version.group + "/" + turn.version.number : i}>
          {turn.role === "user" && turn.version ? <EditableMessage text={turn.text} disabled={uploading}
            variants={versions.get(turn.version.group)} current={turn.version.number}
            onPick={id => {
              voice.cancel();
              position.current = rememberVersionPosition(log.current, state.pathId, turn.version!.group);
              return switchOpening(id);
            }}
            onEdit={value => {
              voice.cancel();
              latest();
              const sent = editOpening(i,value,fresh);
              if (window.matchMedia("(pointer: fine)").matches)
                requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
              return sent;
            }}/> : i === questionIndex && activeQuestion ? <QuestionCard promptId={promptId} question={activeQuestion.prompt}
            choices={answerChoices(activeQuestion.options)} onChoose={value => send(value, true)} /> :
            <div className={"opening-message " + turn.role}>
              <span className="sr-only">{t(turn.role === "user" ? "chat.user" : "chat.assistant")}</span><p>{turn.text}</p>
            </div>}
          {turn.partial && <div className="opening-message partial-reply"><p>{turn.partial}</p></div>}
          {(turn.delivery === "failed" || turn.delivery === "stopped") && <div className="chat-recovery">
            <span role={turn.delivery === "failed" && i === state.turns.length - 1 ? "alert" : undefined}>
              {turn.delivery === "failed" ? turn.error ?? t("errors.MODEL_OUTPUT_INVALID") : t("chat.stopped")}
            </span>
            {turn === last && !state.busy && <button type="button" data-action="retry-opening" onClick={() => { latest(); if (window.matchMedia("(pointer: fine)").matches) input.current?.focus({ preventScroll: true }); void retryOpening(fresh); }}>{t("chat.retry")}</button>}
          </div>}
        </div>)}
        {state.busy && <div className="opening-turn assistant">
          {state.preview && waiting ? <div className="opening-message assistant" aria-live="off"><p data-testid="reply-preview">{state.preview}</p></div> :
            <div className="chat-wait" role="status"><span className="chat-dots" aria-hidden="true"><i/><i/><i/></span><span className={uploading ? undefined : "sr-only"}>{t(uploading ? "chat.uploading" : "chat.thinking")}</span></div>}
        </div>}
      </div>
      {away && <button type="button" className="chat-jump" data-action="chat-latest" aria-label={t("ai.latest")} title={t("ai.latest")} onClick={latest}><Icon name="arrowDown"/></button>}
    </div>
    <form className="chat-composer" onSubmit={event => {event.preventDefault(); send();}}
      onDrop={event => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault(); event.stopPropagation(); stageFiles(Array.from(event.dataTransfer.files));
      }} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}>
      {state.files.length > 0 && <ul className="chat-files" aria-label={t("chat.attached")}>
        {state.files.map((file, i) => <Attachment key={i} file={file} index={i} disabled={uploading} />)}
      </ul>}
      <ChatInput inputRef={input} onSend={() => send()} data-testid="start-brief" rows={1} maxLength={1000}
        value={state.draft} readOnly={uploading} aria-describedby={questionIndex >= 0 ? promptId : undefined}
        aria-label={t(activeQuestion ? "chat.custom" : "chat.title")}
        placeholder={t(activeQuestion ? "chat.custom" : waiting ? "chat.nextDraft" : state.files.length ? "chat.noteOptional" : state.turns.length ? "chat.followup" : "chat.placeholder")}
        onChange={e => openingDraft(e.target.value)} onPaste={e => {
          if (e.clipboardData.files.length) { e.preventDefault(); stageFiles(Array.from(e.clipboardData.files)); }
        }} />
      <div className="chat-tools">
        <Button action="empty-import" variant="quiet" className="chat-attach" disabled={uploading}
          title={t("chat.attach")} aria-label={t("chat.attach")} onClick={() => picker.current?.click()}>
          <Icon name="plus"/><span>{t("chat.attach")}</span>
        </Button>
        <ReadingSwitch disabled={uploading} compact/>{voice.mic}
        {waiting ? <Button key="stop" action="stop-opening" variant="primary" className="chat-send chat-stop" aria-label={t("chat.stop")} title={t("chat.stop")}
          onClick={() => { stopOpening(); input.current?.focus({ preventScroll: true }); }}><Icon name="stop"/></Button> :
          <Button key="send" action="start-send" type="submit" variant="primary"
            className={"chat-send" + (arrangeFiles ? " chat-send-layout" : "")} aria-label={sendLabel} title={sendLabel}
            disabled={uploading || voice.active || (!state.draft.trim() && !arrangeFiles)}>
            {arrangeFiles ? sendLabel : <Icon name="arrowUp"/>}
          </Button>}
      </div>
      {voice.feedback}
    </form>
    <input type="file" hidden ref={picker} multiple accept=".svg,.png,.jpg,.jpeg,.webp" onChange={e => {
      stageFiles(Array.from(e.target.files ?? [])); e.target.value = ""; input.current?.focus({ preventScroll: true });
    }}/>
    {state.lostFiles > 0 && !state.error && <p className="opening-status" role="status">{t("chat.reattach", {count:state.lostFiles})}</p>}
    {state.error && <p className="opening-error" role="alert">{state.error}</p>}
    {!fresh && state.turns.length > 0 && !state.busy && <button type="button" className="opening-new" data-action="new-opening" onClick={() => {
      voice.cancel(); resetOpening(); latest(); input.current?.focus({ preventScroll:true });
    }}><Icon name="plus"/>{t("chat.new")}</button>}
  </div>;
}
