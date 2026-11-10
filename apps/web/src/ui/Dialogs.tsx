import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DEFAULT_PNG_DPI, PNG_DPI_OPTIONS, SVG_SUPPORT, type ExportRequest } from "@panelstudio/contracts";
import { api } from "../api/client";
import { BUNDLED_FONTS } from "@panelstudio/contracts";
import {
  discardDraft,
  downloadAgain,
  downloadRecovery,
  exportFigure,
  offerAssets,
  retrySave,
} from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { Button } from "./widgets";

export function Dialogs() {
  const dialog = useWorkspace((state) => state.dialog);
  return (
    <>
      <SettingsDialog open={dialog === "settings"} />
      <ShortcutsDialog open={dialog === "shortcuts"} />
      <ExportDialog open={dialog === "export"} />
      <SvgDialog open={dialog === "svg"} />
      <AssetDialog open={dialog === "asset"} />
      <RecoveryDialog open={dialog === "recovery"} />
      <QuotaDialog open={dialog === "quota"} />
    </>
  );
}

function Shell(props: { open: boolean; title: string; children: ReactNode; onClose?: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => { if (!open) props.onClose ? props.onClose() : patch({ dialog: null }); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <Dialog.Title>{props.title}</Dialog.Title>
          {props.children}
          <Dialog.Close asChild>
            <Button action="close-dialog">{t("a11y.close")}</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsDialog({ open }: { open: boolean }) {
  const { t, i18n } = useTranslation();
  const state = useWorkspace();
  return (
    <Shell open={open} title={t("settings.title")}>
      <label className="field">
        <span>{t("settings.theme")}</span>
        <select value={state.theme} onChange={(event) => patch({ theme: event.target.value === "dark" ? "dark" : "light" })}>
          <option value="light">{t("settings.light")}</option>
          <option value="dark">{t("settings.dark")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("settings.language")}</span>
        <select
          value={state.locale}
          onChange={(event) => {
            const locale = event.target.value === "en-US" ? "en-US" : "zh-CN";
            patch({ locale });
            void i18n.changeLanguage(locale);
          }}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </label>
      <label className="field">
        <span>{t("settings.reduceMotion")}</span>
        <select value={state.motion} onChange={(event) => patch({ motion: event.target.value === "on" || event.target.value === "off" ? event.target.value : "system" })}>
          <option value="system">{t("settings.motionSystem")}</option>
          <option value="on">{t("settings.motionOn")}</option>
          <option value="off">{t("settings.motionOff")}</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={state.reduceTransparency} onChange={(event) => patch({ reduceTransparency: event.target.checked })} />
        {t("settings.reduceTransparency")}
      </label>
      <p>{t("settings.aiNote")}</p>
    </Shell>
  );
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

function ExportDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [metadata, setMetadata] = useState(true);
  const [dpi, setDpi] = useState<(typeof PNG_DPI_OPTIONS)[number]>(DEFAULT_PNG_DPI);
  const [fonts, setFonts] = useState(true);
  const revision = state.confirmed?.revision ?? 0;
  const running = state.exportState?.status === "running" ? state.exportState : null;
  return (
    <Shell open={open} title={t("export.title")}>
      <p>{t("status.fontMissing", { families: BUNDLED_FONTS.map((font) => font.family).join(", ") })}</p>
      {running ? <p data-testid="export-phase">{t("export.running", { revision: running.revision, phase: running.phase })}</p> : null}
      <Button action="export-svg" disabledReason={state.confirmed ? undefined : t("app.noProject")} onClick={() => void exportFigure({ revision, format: "svg", options: { includeMetadata: metadata } } satisfies ExportRequest)}>
        {t("export.svg")}
      </Button>
      <label className="check">
        <input type="checkbox" checked={metadata} onChange={(event) => setMetadata(event.target.checked)} />
        {t("export.includeMetadata")}
      </label>
      <label className="field">
        <span>{t("export.dpi")}</span>
        <select value={dpi} onChange={(event) => setDpi(Number(event.target.value) as (typeof PNG_DPI_OPTIONS)[number])}>
          {PNG_DPI_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <Button action="export-png" disabledReason={state.confirmed ? undefined : t("app.noProject")} onClick={() => void exportFigure({ revision, format: "png", options: { dpi } })}>
        {t("export.png")}
      </Button>
      <label className="check">
        <input type="checkbox" checked={fonts} onChange={(event) => setFonts(event.target.checked)} />
        {t("export.includeFonts")}
      </label>
      <Button action="export-project" disabledReason={state.confirmed ? undefined : t("app.noProject")} onClick={() => void exportFigure({ revision, format: "project", options: { includeBundledFonts: fonts } })}>
        {t("export.project")}
      </Button>
      {state.exportState?.status === "ready" ? (
        <>
          <p>{t("export.blockedHint")}</p>
          <Button action="download-again" onClick={() => void downloadAgain()}>{t("export.downloadAgain")}</Button>
          <ul>
            {state.exportState.diagnostics.map((item, index) => (
              <li key={`${item.code}-${index}`}>{item.code} {item.messageKey} {Object.values(item.params).join(" ")}</li>
            ))}
          </ul>
        </>
      ) : null}
      {state.exportState?.status === "failed" ? <p>{state.exportState.message}</p> : null}
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
          <div><dt>{t("assets.original")}</dt><dd>{asset.originalMediaType}</dd></div>
          <div><dt>SHA-256</dt><dd>{asset.originalSha256}</dd></div>
          <div><dt>{asset.originalByteLength}</dt><dd>{asset.status}</dd></div>
          {asset.diagnostics.map((item) => <div key={item.code}><dt>{item.code}</dt><dd>{item.messageKey}</dd></div>)}
          {asset.status === "ready" ? asset.normalized.normalizationNotes.map((note) => <p key={note}>{note}</p>) : null}
        </dl>
      ) : <p>{t("errors.NOT_FOUND")}</p>}
    </Shell>
  );
}

function RecoveryDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspace();
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
