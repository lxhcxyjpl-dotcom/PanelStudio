import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BUNDLED_FONTS, DEFAULT_PNG_DPI, PNG_DPI_OPTIONS, type ExportRequest } from "@panelstudio/contracts";
import { formatDiagnostic } from "../i18n/diagnostic";
import { downloadAgain, exportFigure } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { Shell } from "./DialogShell";
import { Button, Icon, TabBar } from "./widgets";

export function ExportDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [format, setFormat] = useState<"svg" | "png" | "project">("svg");
  const [metadata, setMetadata] = useState(true);
  const [dpi, setDpi] = useState<(typeof PNG_DPI_OPTIONS)[number]>(DEFAULT_PNG_DPI);
  const [fonts, setFonts] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (open) { setRevision(useWorkspace.getState().confirmed?.revision ?? 0); setFormat("svg"); } }, [open]);
  const running = state.exportState?.status === "running";
  const request = (): ExportRequest => format === "svg" ? { revision, format, options: { includeMetadata: metadata } }
    : format === "png" ? { revision, format, options: { dpi } } : { revision, format, options: { includeBundledFonts: fonts } };
  return <Shell open={open} title={t("export.title")} className="export-dialog">
    <p className="export-context" data-testid="export-revision">{state.title} · {t("export.revision", { revision })}</p>
    {state.cards.length > 0 && <p className="export-advice" role="status">{t("export.pendingDraft", { revision })}</p>}
    {state.draft && <div className="export-advice"><p>{t("export.unsaved")}</p><Button action="export-recover" variant="quiet" onClick={() => patch({ dialog: "recovery" })}>{t("save.retry")}</Button></div>}
    <TabBar id="export-format" label={t("export.format")} value={format} onChange={setFormat} items={(["svg", "png", "project"] as const).map(value => ({value, action:"format-" + value, label:value === "project" ? t("export.project") : value.toUpperCase(), disabled:running}))} />
    <div className="export-format-content" role="tabpanel" id="export-format-panel" aria-labelledby={"export-format-" + format}>
      {format === "svg" && <><p>{t("export.editableDetail")}</p><label className="check"><input type="checkbox" checked={metadata} disabled={running} onChange={event => setMetadata(event.target.checked)} />{t("export.includeMetadata")}</label></>}
      {format === "png" && <><label className="field"><span>{t("export.dpi")}</span><select value={dpi} disabled={running} onChange={event => setDpi(Number(event.target.value) as typeof dpi)}>
        {PNG_DPI_OPTIONS.map(option => <option key={option} value={option}>{option} DPI</option>)}</select></label>
        {state.confirmed && <p className="numeric-text">{t("export.dimensions", { width: Math.round(state.confirmed.document.canvas.widthMm * dpi / 25.4), height: Math.round(state.confirmed.document.canvas.heightMm * dpi / 25.4) })}</p>}</>}
      {format === "project" && <><p>{t("export.packageDetail")}</p><label className="check"><input type="checkbox" checked={fonts} disabled={running} onChange={event => setFonts(event.target.checked)} />{t("export.includeFonts")}</label></>}
      <details className="export-font-details" open={format === "svg"}><summary>{t("export.fontDetails")}</summary>
        <p data-testid="font-status">{BUNDLED_FONTS.map(font => font.family).join(" / ")}</p><p>{t("export.fontAdvice")}</p>
        <a className="button quiet" data-action="download-fonts" href="/api/v1/fonts/bundle" download="panelstudio-fonts.zip">{t("export.downloadFonts")}<Icon name="import" /></a>
      </details>
    </div>
    {state.exportState?.status === "running" && <p role="status" data-testid="export-phase">{t("export.running", { revision: state.exportState.revision, phase: state.exportState.phase })}</p>}
    {state.exportState?.status === "ready" && <div className="export-result" role="status"><strong>{state.exportState.filename}</strong>
      <Button action="download-again" variant="quiet" onClick={() => void downloadAgain()}>{t("export.downloadAgain")}</Button>
      <ul data-testid="export-diagnostics">{state.exportState.diagnostics.map((item, index) => <li key={index}>{formatDiagnostic(t, item)}</li>)}</ul></div>}
    {state.exportState?.status === "failed" && <p role="alert" className="field-error">{state.exportState.message}</p>}
    <div className="dialog-actions export-actions"><Button action="export-close" variant="quiet" onClick={() => patch({ dialog: null })}>{t("layout.cancel")}</Button>
      <Button action={"export-" + format} variant="primary" disabledReason={running ? t("layout.loading") : !state.confirmed ? t("app.noProject") : undefined} onClick={() => void exportFigure(request())}><Icon name="export" />{t("export." + format)}</Button></div>
  </Shell>;
}
