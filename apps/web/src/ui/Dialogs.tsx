import { Shell } from "./DialogShell";
export { Shell } from "./DialogShell";
import { SettingsDialog } from "./SettingsDialog";
import { ExportDialog } from "./ExportDialog";
import { ProjectsDialog } from "./ProjectsDialog";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SVG_SUPPORT } from "@panelstudio/contracts";
import { api } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import {
  discardDraft,
  downloadRecovery,
  offerAssets,
  retrySave,
  transact,
} from "../state/session";
import { patch, useWorkspace, useWorkspaceFields } from "../state/store";
import { Button, Icon } from "./widgets";
import { baseDocument } from "../state/types";
import type { PublicationContext } from "@panelstudio/contracts";

export function Dialogs() {
  const dialog = useWorkspace((state) => state.dialog);
  return (
    <>
      <SettingsDialog open={dialog === "settings" || dialog === "ai-settings"} initialSection={dialog === "ai-settings" ? "ai" : "general"} />
      <ShortcutsDialog open={dialog === "shortcuts"} />
      <ExportDialog open={dialog === "export"} />
      <ProjectsDialog open={dialog === "projects"} />
      <SvgDialog open={dialog === "svg"} />
      <AssetDialog open={dialog === "asset"} />
      <RecoveryDialog open={dialog === "recovery"} />
      <QuotaDialog open={dialog === "quota"} />
      <PublicationDialog open={dialog === "publication"} />
    </>
  );
}

function PublicationDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspaceFields("projectId", "draft");
  const [value, setValue] = useState<PublicationContext>({ journal: "", field: "", message: "", preference: "auto" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setValue(baseDocument(useWorkspace.getState())?.publicationContext ??
      { journal: "", field: "", message: useWorkspace.getState().startMessage, preference: "auto" });
  }, [open, state.projectId]);
  return <Shell open={open} title={t("publication.title")} className="brief-dialog">
    <form className="publication-form" onSubmit={(event) => {
      event.preventDefault();
      setBusy(true);
      void transact([{ type: "figure.setPublicationContext", publicationContext: {
        journal: value.journal.trim(), field: value.field.trim(), message: value.message.trim(), preference: value.preference,
      } }]).then(() => {
        const now = useWorkspace.getState();
        if (now.saveState === "saved" && now.dialog === "publication") patch({ dialog: null, startMessage: "" });
      }).finally(() => setBusy(false));
    }}>
      <div className="brief-intro"><span className="brief-symbol"><Icon name="spark" /></span><h3>{t("publication.heading")}</h3></div>
      <label className="field brief-message"><span className="sr-only">{t("publication.message")}</span>
        <textarea autoFocus data-testid="figure-message" value={value.message} maxLength={1000} rows={3}
          placeholder={t("publication.messagePlaceholder")} onChange={(e) => setValue({ ...value, message: e.target.value })} />
      </label>
      <div className="brief-context-fields">
      <label className="field"><span>{t("publication.journal")}</span>
        <input data-testid="target-journal" value={value.journal} maxLength={160} list="journal-suggestions"
          placeholder={t("publication.journalPlaceholder")} onChange={(e) => setValue({ ...value, journal: e.target.value })} />
        <datalist id="journal-suggestions"><option value="Nature" /><option value="Nature Communications" /><option value="Science" /><option value="Cell" /></datalist>
      </label>
      <label className="field"><span>{t("publication.field")}</span>
        <input data-testid="research-field" value={value.field} maxLength={240}
          placeholder={t("publication.fieldPlaceholder")} onChange={(e) => setValue({ ...value, field: e.target.value })} />
      </label>
      </div>
      <fieldset className="brief-preferences" data-testid="layout-preference"><legend>{t("publication.preference")}</legend>
        {(["auto", "comparison", "emphasis", "compact"] as const).map(kind => <label key={kind} className="brief-choice" data-checked={value.preference === kind}>
          <input type="radio" name="layout-preference" value={kind} checked={value.preference === kind} onChange={() => setValue({ ...value, preference: kind })} />
          <span className={"layout-glyph " + kind} aria-hidden="true"><i /><i /><i /><i /></span>
          <span>{t("publication." + kind)}</span><Icon name="check" />
        </label>)}
      </fieldset>
      {state.draft && <p className="brief-error" role="alert">{t("save.failed")}</p>}
      <div className="dialog-actions">
        <Button action="skip-publication" variant="quiet" disabled={busy} onClick={() => patch({ dialog: null })}>{t("publication.later")}</Button>
        <Button action="save-publication" variant="primary" type="submit" disabled={busy || Boolean(state.draft)}>{t("publication.save")}</Button>
      </div>
    </form>
  </Shell>;
}

function ShortcutsDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const rows = [
    ["Cmd/Ctrl+Z", "shortcuts.undo"],
    ["Cmd/Ctrl+Shift+Z", "shortcuts.redo"],
    ["Delete / Backspace", "shortcuts.delete"],
    ["Cmd/Ctrl+A", "shortcuts.selectAll"],
    ["Escape", "shortcuts.escape"],
    ["Space", "shortcuts.pan"],
    ["+ / −", "shortcuts.zoom"],
    ["Shift+1", "shortcuts.fit"],
    ["Shift+0", "shortcuts.actual"],
    ["Arrow", "shortcuts.nudge"],
    ["Shift+Arrow", "shortcuts.nudgeShift"],
    ["Cmd/Ctrl+G", "shortcuts.group"],
    ["Cmd/Ctrl+Shift+G", "shortcuts.ungroup"],
    ["V", "shortcuts.select"],
    ["C", "shortcuts.crop"],
    ["?", "shortcuts.help"],
  ] as const;
  return (
    <Shell open={open} title={t("shortcuts.title")}>
      <table className="shortcuts">
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={keys}>
              <th>{keys}</th>
              <td>{t(label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

function SvgDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  return (
    <Shell open={open} title={t("dialog.svgTitle")}>
      <p>{SVG_SUPPORT.unsupportedFeaturePolicy}</p>
      <ul>{SVG_SUPPORT.reject.map((item) => <li key={item}>{item}</li>)}</ul>
      <ul>{SVG_SUPPORT.normalizationSteps.map((item) => <li key={item}>{item}</li>)}</ul>
    </Shell>
  );
}

function AssetDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const projectId = useWorkspace((state) => state.projectId);
  const assetId = useWorkspace((state) => state.assetInfoId);
  const assets = useQuery({
    queryKey: ["assets", projectId],
    enabled: Boolean(projectId && open),
    queryFn: () => api.assets(projectId ?? ""),
  });
  const asset = assets.data?.items.find((item) => item.id === assetId);
  return (
    <Shell open={open} title={t("dialog.assetTitle")}>
      {asset ? (
        <dl>
          <div><dt>{t("panels.name")}</dt><dd>{asset.originalFilename}</dd></div>
          <div><dt>{t("assets.mediaType")}</dt><dd>{asset.originalMediaType}</dd></div>
          {asset.normalized && (asset.normalized.rasterPixelSize
            ? <div><dt>{t("assets.pixelDimensions")}</dt><dd>{asset.normalized.rasterPixelSize.width} × {asset.normalized.rasterPixelSize.height} px</dd></div>
            : <div><dt>{t("assets.viewport")}</dt><dd>{asset.normalized.viewport.width} × {asset.normalized.viewport.height}</dd></div>)}
          <div><dt>{t("assets.fileSize")}</dt><dd>{asset.originalByteLength.toLocaleString()} B</dd></div>
          <div><dt>{t("assets.status")}</dt><dd>{t("assets." + asset.status)}</dd></div>
          <div><dt>SHA-256</dt><dd>{asset.originalSha256}</dd></div>
          {asset.diagnostics.map((item, index) => <div key={`${item.code}-${index}`}><dt>{formatDiagnostic(t, item)}</dt><dd>{item.severity}</dd></div>)}
          {asset.status === "ready" ? asset.normalized.normalizationNotes.map((note) => <p key={note}>{note}</p>) : null}
        </dl>
      ) : <p>{t("errors.NOT_FOUND")}</p>}
    </Shell>
  );
}

function RecoveryDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspaceFields("saveState", "serverSnapshot");
  return (
    <Shell open={open} title={t("dialog.recoveryTitle")}>
      <p>{state.saveState === "offline" ? t("save.offline") : state.saveState === "conflict" ? t("save.conflict") : t("save.failed")}</p>
      <p>{t("save.recoveryPurpose")}</p>
      <Button action="retry-save" onClick={() => void retrySave(false)}>{t("save.retry")}</Button>
      <Button action="reapply-draft" disabledReason={state.serverSnapshot ? undefined : t("save.conflict")} onClick={() => void retrySave(true)}>{t("save.reapply")}</Button>
      <Button action="discard-draft" onClick={() => void discardDraft()}>{t("save.reloadServer")}</Button>
      <Button action="download-recovery" onClick={downloadRecovery}>{t("save.downloadRecovery")}</Button>
    </Shell>
  );
}

function QuotaDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const quota = useWorkspace((state) => state.quota);
  const [picked, setPicked] = useState<string[]>([]);
  const remaining = quota?.remaining ?? 0;
  return (
    <Shell open={open} title={t("assets.quotaTitle")} onClose={() => patch({ dialog: null, quota: null })}>
      <p>{t("assets.remaining", { count: remaining })}</p>
      <p>{t("assets.choose")}</p>
      {(quota?.assetIds ?? []).map((assetId) => (
        <label key={assetId} className="check">
          <input
            type="checkbox"
            checked={picked.includes(assetId)}
            disabled={!picked.includes(assetId) && picked.length >= remaining}
            onChange={(event) => {
              setPicked((current) => event.target.checked ? [...current, assetId] : current.filter((id) => id !== assetId));
            }}
          />
          {assetId}
        </label>
      ))}
      <Button
        action="confirm-quota"
        disabledReason={remaining > 0 && picked.length > 0 && picked.length <= remaining ? undefined : t("assets.remaining", { count: remaining })}
        onClick={() => {
          const ids = picked.slice(0, remaining);
          patch({ dialog: null, quota: null });
          void offerAssets(ids);
        }}
      >
        {t("assets.add")}
      </Button>
    </Shell>
  );
}
