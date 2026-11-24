import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supportsDeepSeekSpeech } from "@panelstudio/contracts";
import { api, ApiClientError } from "../api/client";
import { captureDictation, dictationWav, insertDictation } from "../model/dictation";
import { patch } from "../state/store";
import { Icon } from "./widgets";
import "./dictation.css";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Session = {
  controller: AbortController;
  field: Field;
  original: string;
  start: number;
  end: number;
  finish?: () => void;
  wav?: Blob;
};
type View =
  | { phase: "idle" | "starting" | "transcribing" }
  | { phase: "recording"; since: number }
  | { phase: "notice"; message: string; retry?: boolean; settings?: boolean; overflow?: string };

let cancelCurrent: (() => void) | undefined;

function RecordingTime({ since }: { since: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - since) / 1000)), 500);
    return () => clearInterval(timer);
  }, [since]);
  return <time aria-hidden="true">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} / 2:00</time>;
}

function failure(error: unknown): Extract<View, { phase: "notice" }> {
  let message = "voice.failed", retry = false, settings = false;
  if (error instanceof ApiClientError) {
    if (error.code === "PROVIDER_NOT_CONFIGURED" || error.status === 401 || error.status === 403) {
      message = "voice.connection"; settings = true;
    } else if (error.status === 402) message = "voice.balance";
    else if (!error.status || error.status === 429 || error.status >= 500) {
      message = error.status === 429 || error.status === 503 ? "voice.busy" : "voice.network"; retry = true;
    }
  } else if (error instanceof DOMException) {
    if (["NotAllowedError", "SecurityError"].includes(error.name)) message = "voice.denied";
    else if (error.name === "NotFoundError") message = "voice.noDevice";
    else if (error.name === "NotSupportedError") message = "voice.unsupported";
    else if (error.name === "NoSpeechError") message = "voice.silence";
    else if (error.name === "NotReadableError") message = "voice.deviceBusy";
  }
  return { phase: "notice", message, retry, settings };
}

export function useDictation(ref: RefObject<Field | null>, onChange: (value: string) => void, scope: string, disabled: boolean) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const session = useRef<Session | null>(null);
  const [view, setView] = useState<View>({ phase: "idle" });
  const cancel = useCallback(() => {
    session.current?.controller.abort();
    session.current = null;
    if (cancelCurrent === cancel) cancelCurrent = undefined;
    setView({ phase: "idle" });
  }, []);
  useLayoutEffect(() => cancel, [scope, disabled, cancel]);
  useEffect(() => {
    const hidden = () => { if (document.hidden && session.current) cancel(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel]);

  function current(s: Session) {
    return session.current === s && !s.controller.signal.aborted && ref.current === s.field && s.field.isConnected;
  }
  function showFailure(s: Session, error: unknown) {
    if (!current(s)) return;
    const notice = failure(error);
    if (notice.retry && !s.wav) notice.message = "voice.checkConnection";
    if (!notice.retry) s.wav = undefined;
    setView({ ...notice, retry: notice.retry && Boolean(s.wav) });
  }
  async function transcribe(s: Session) {
    if (!s.wav || !current(s)) return;
    setView({ phase: "transcribing" });
    try {
      const { text } = await api.transcribeSpeech(s.wav, s.controller.signal);
      if (!current(s)) return;
      s.wav = undefined;
      if (!text.trim()) { setView({ phase: "notice", message: "voice.silence" }); return; }
      const field = s.field;
      const unchanged = field.value === s.original;
      const result = insertDictation(field.value, unchanged ? s.start : field.selectionStart ?? field.value.length,
        unchanged ? s.end : field.selectionEnd ?? field.value.length, text.trim());
      if (field.maxLength >= 0 && result.value.length > field.maxLength) {
        setView({ phase: "notice", message: "voice.limit", overflow: text }); return;
      }
      const restoreFocus = field.form?.contains(document.activeElement) || document.activeElement === document.body;
      onChange(result.value);
      cancel();
      requestAnimationFrame(() => {
        if (field !== ref.current || !field.isConnected || field.value !== result.value || !restoreFocus) return;
        field.focus({ preventScroll: true }); field.setSelectionRange(result.caret, result.caret);
      });
    } catch (error) { showFailure(s, error); }
  }
  async function start() {
    const field = ref.current;
    if (disabled || !field || field.readOnly) return;
    cancelCurrent?.();
    const s: Session = { field, original: field.value, start: field.selectionStart ?? field.value.length,
      end: field.selectionEnd ?? field.value.length, controller: new AbortController() };
    session.current = s; cancelCurrent = cancel;
    setView({ phase: "starting" });
    try {
      const settings = await queries.fetchQuery({ queryKey: ["ai-provider"], queryFn: api.providerSettings, staleTime: 15_000 });
      if (!current(s)) return;
      if (!settings.hasSecret || !supportsDeepSeekSpeech(settings.config?.baseUrl)) {
        setView({ phase: "notice", message: "voice.connection", settings: true }); return;
      }
      const recorded = await captureDictation(s.controller.signal, finish => {
        s.finish = finish;
        setView({ phase: "recording", since: Date.now() });
      });
      if (!current(s)) return;
      s.finish = undefined;
      setView({ phase: "transcribing" });
      const wav = await dictationWav(recorded);
      if (!current(s)) return;
      s.wav = wav;
      await transcribe(s);
    } catch (error) { showFailure(s, error); }
  }

  const { phase } = view;
  const active = phase === "starting" || phase === "recording" || phase === "transcribing";
  const label = t(phase === "recording" ? "voice.finish" : phase === "transcribing" ? "voice.transcribing" : phase === "starting" ? "voice.starting" : "voice.start");
  const mic = <button type="button" className="voice-button" data-action="dictate" data-phase={phase}
    disabled={disabled || phase === "transcribing" || phase === "starting"} aria-label={label} title={label}
    onClick={() => { if (phase === "recording") session.current?.finish?.(); else void start(); }}>
    <Icon name={phase === "recording" ? "stop" : phase === "transcribing" || phase === "starting" ? "voicePending" : "mic"} />
  </button>;
  const feedback = phase !== "idle" && <div className="voice-feedback" data-testid="voice-feedback">
    <span role="status">{t(view.phase === "notice" ? view.message : view.phase === "recording" ? "voice.recording" :
      view.phase === "transcribing" ? "voice.transcribing" : "voice.starting")}</span>
    {view.phase === "recording" && <RecordingTime since={view.since} />}
    {view.phase === "notice" && view.settings && <button type="button" onClick={() => { cancel(); patch({ dialog: "ai-settings" }); }}>{t("connection.title")}</button>}
    {view.phase === "notice" && view.retry && <button type="button" onClick={() => { if (session.current) void transcribe(session.current); }}>{t("voice.retry")}</button>}
    <button type="button" data-action="cancel-dictation" onClick={cancel}>{t(active ? "voice.cancel" : "voice.dismiss")}</button>
    {view.phase === "notice" && view.overflow && <textarea readOnly value={view.overflow} aria-label={t("voice.transcript")} />}
  </div>;
  return { active, mic, feedback, cancel };
}
