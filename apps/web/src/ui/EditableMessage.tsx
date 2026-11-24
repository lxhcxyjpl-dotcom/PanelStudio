import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../model/feedback";
import { ChatInput } from "./ChatInput";
import { Icon } from "./widgets";

type Props = {
  text: string;
  maxLength?: number;
  newFigureVersion?: boolean;
  disabled?: boolean;
  variants?: { id: string; number: number }[];
  current?: number;
  onPick?: (id: string) => void | Promise<void>;
  onEdit?: (value: string) => void | Promise<void>;
  onQuote?: () => void;
};
export function EditableMessage({text, maxLength = 1000, newFigureVersion = false, disabled = false, variants = [], current = 1, onPick, onEdit, onQuote}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null), [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null), pencil = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const inEditor = draft !== null;
  useLayoutEffect(() => {
    const el = field.current;
    if (inEditor && el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      editor.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [inEditor]);
  function close() {
    setDraft(null); setError("");
    requestAnimationFrame(() => pencil.current?.focus({ preventScroll: true }));
  }
  async function save() {
    const value = draft?.trim();
    if (!value || value === text.trim() || !onEdit || disabled || saving) return;
    setSaving(true); setError("");
    try { await onEdit(value); setDraft(null); }
    catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }
  async function pick(id: string) {
    if (!onPick || disabled || saving) return;
    setSaving(true); setError("");
    try { await onPick(id); } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }
  const position = variants.findIndex(v => v.number === current);
  if (draft !== null) return <div className="message-edit" ref={editor} aria-busy={saving} onKeyDown={e => {
    if (e.key === "Escape" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && !saving) { e.preventDefault(); e.stopPropagation(); close(); }
  }}>
    <ChatInput inputRef={field} data-testid="edit-message-input" maxLength={maxLength} rows={2} value={draft}
      readOnly={saving} aria-label={t("chat.editMessage")} onChange={e=>setDraft(e.target.value)} onSend={() => void save()} />
    {error && <p role="alert">{error}</p>}
    <div className="edit-actions">
      <button type="button" data-action="cancel-edit" disabled={saving} onClick={close}>{t("chat.cancelEdit")}</button>
      <button type="button" data-action="resend-edit" disabled={disabled || saving || !draft.trim() || text.trim() === draft.trim()} onClick={() => void save()}>
        {t(saving ? "chat.sendingEdit" : newFigureVersion ? "chat.createVersion" : "chat.resend")}
      </button>
    </div>
  </div>;
  return <div className="author-message">
    <div className="opening-message user"><span className="sr-only">{t("chat.user")}</span><p>{text}</p></div>
    <div className="message-tools">
      {onPick && variants.length > 1 && position >= 0 && <div className="message-versions" role="group" aria-label={t("chat.versions")}>
        <button type="button" data-action="previous-version" aria-label={t("chat.previousVersion")} title={t("chat.previousVersion")}
          disabled={disabled || saving || position === 0} onClick={() => void pick(variants[position-1]!.id)}><Icon name="chevron"/></button>
        <span aria-live="polite">{position + 1} / {variants.length}</span>
        <button type="button" data-action="next-version" aria-label={t("chat.nextVersion")} title={t("chat.nextVersion")}
          disabled={disabled || saving || position === variants.length - 1} onClick={() => void pick(variants[position+1]!.id)}><Icon name="chevron"/></button>
      </div>}
      {(onEdit || onQuote) && <button type="button" ref={pencil} className="message-pencil" data-action={onEdit ? "edit-message" : "quote-message"}
        disabled={disabled || saving} aria-label={t(onEdit ? "chat.editMessage" : "chat.quoteMessage")} title={t(onEdit ? "chat.editMessage" : "chat.quoteMessage")}
        onClick={() => { if (onEdit) { setError(""); setDraft(text); } else onQuote?.(); }}><Icon name={onEdit ? "edit" : "redo"}/></button>}
    </div>
    {error && <p className="opening-error" role="alert">{error}</p>}
  </div>;
}
