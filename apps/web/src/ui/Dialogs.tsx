import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DEFAULT_PNG_DPI, PNG_DPI_OPTIONS, SVG_SUPPORT, type AIProviderConfig, type ExportRequest } from "@panelstudio/contracts";
import { api, newKey, waitForJob } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { queryClient } from "../state/query";
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
      <ProviderSettings />
    </Shell>
  );
}

function ProviderSettings() {
  const { t } = useTranslation();
  const settings = useQuery({ queryKey: ["ai-provider"], queryFn: () => api.providerSettings() });
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [structured, setStructured] = useState<AIProviderConfig["capabilities"]["structuredOutput"]>("json_object");
  const [imageInput, setImageInput] = useState(false);
  const [allowLocal, setAllowLocal] = useState(false);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const config = settings.data?.config;
    if (!config) return;
    setBaseUrl(config.baseUrl);
    setModel(config.model);
    setStructured(config.capabilities.structuredOutput);
    setImageInput(config.capabilities.imageInput);
    setAllowLocal(config.allowLocalEndpoint);
  }, [settings.data?.config]);
  async function saveConfig() {
    try {
      await api.saveProvider(
        {
          adapter: "openai-compatible",
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          capabilities: { imageInput, structuredOutput: structured },
          allowLocalEndpoint: allowLocal,
        },
        newKey(),
      );
      await queryClient.invalidateQueries({ queryKey: ["ai-provider"] });
      setMessage(t("settings.saveProvider"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("ai.jobFailed"));
    }
  }
  async function saveSecret() {
    try {
      await api.saveSecret(secret, newKey());
      setSecret("");
      await queryClient.invalidateQueries({ queryKey: ["ai-provider"] });
      setMessage(t("settings.hasSecret"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("ai.jobFailed"));
    }
  }
  async function removeSecret() {
    try {
      await api.deleteSecret(newKey());
      setSecret("");
      await queryClient.invalidateQueries({ queryKey: ["ai-provider"] });
      setMessage(t("settings.noSecret"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("ai.jobFailed"));
    }
  }
  async function testProvider() {
    try {
      const accepted = await api.testProvider(newKey());
      const job = await waitForJob(accepted.jobId);
      if (job.status === "succeeded" && job.result && "latencyMs" in job.result) {
        setMessage(t("ai.testOk", { latency: job.result.latencyMs }));
        return;
      }
      setMessage(job.status === "failed" ? job.error?.message ?? t("ai.jobFailed") : t("ai.jobFailed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("ai.jobFailed"));
    }
  }
  return (
    <div className="section" data-testid="ai-settings">
      <h2>{t("settings.provider")}</h2>
      <p>{t("settings.aiNote")}</p>
      <p data-testid="ai-secret-state">{settings.data?.hasSecret ? t("settings.hasSecret") : t("settings.noSecret")}</p>
      <label className="field">
        <span>{t("settings.baseUrl")}</span>
        <input data-testid="ai-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </label>
      <label className="field">
        <span>{t("settings.model")}</span>
        <input data-testid="ai-model" value={model} onChange={(event) => setModel(event.target.value)} />
      </label>
      <label className="field">
        <span>{t("settings.structured")}</span>
        <select data-testid="ai-structured" value={structured} onChange={(event) => setStructured(event.target.value as AIProviderConfig["capabilities"]["structuredOutput"])}>
          <option value="json_schema">json_schema</option>
          <option value="json_object">json_object</option>
          <option value="text_json">text_json</option>
        </select>
      </label>
      <label className="check">
        <input data-testid="ai-image" type="checkbox" checked={imageInput} onChange={(event) => setImageInput(event.target.checked)} />
        {t("settings.imageInput")}
      </label>
      <label className="check">
        <input data-testid="ai-local" type="checkbox" checked={allowLocal} onChange={(event) => setAllowLocal(event.target.checked)} />
        {t("settings.allowLocal")}
      </label>
      <Button action="save-provider" disabledReason={baseUrl.trim() && model.trim() ? undefined : t("settings.baseUrl")} onClick={() => void saveConfig()}>
        {t("settings.saveProvider")}
      </Button>
      <label className="field">
        <span>{t("settings.secret")}</span>
        <input data-testid="ai-secret" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} />
      </label>
      <Button action="save-secret" disabledReason={secret.trim() ? undefined : t("settings.secret")} onClick={() => void saveSecret()}>
        {t("settings.saveSecret")}
      </Button>
      <Button action="delete-secret" disabledReason={settings.data?.hasSecret ? undefined : t("settings.noSecret")} onClick={() => void removeSecret()}>
        {t("settings.deleteSecret")}
      </Button>
      <Button action="test-provider" disabledReason={settings.data?.config && settings.data.hasSecret ? undefined : t("ai.notConfigured")} onClick={() => void testProvider()}>
        {t("ai.test")}
      </Button>
      {message ? <p data-testid="ai-provider-status">{message}</p> : null}
    </div>
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

function downloadFontBundle(): void {
  const link = document.createElement("a");
  link.href = "/api/v1/fonts/bundle";
  link.download = "panelstudio-fonts.zip";
  link.click();
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
      <p>{t("export.fontList", { families: BUNDLED_FONTS.map((font) => font.family).join(", ") })}</p>
      <p>{t("status.fontsReady", { families: BUNDLED_FONTS.map((font) => font.family).join(", ") })}</p>
      <Button action="download-fonts" onClick={downloadFontBundle}>{t("export.downloadFonts")}</Button>
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
          <ul data-testid="export-diagnostics">
            {state.exportState.diagnostics.map((item, index) => (
              <li key={`${item.code}-${index}`}>{formatDiagnostic(t, item)}</li>
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
          {asset.diagnostics.map((item, index) => <div key={`${item.code}-${index}`}><dt>{formatDiagnostic(t, item)}</dt><dd>{item.severity}</dd></div>)}
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
