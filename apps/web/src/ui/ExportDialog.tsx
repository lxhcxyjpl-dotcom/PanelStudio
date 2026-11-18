import { useLayoutEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BUNDLED_FONTS, DEFAULT_PNG_DPI, PNG_DPI_OPTIONS, pngPixelsFromMm, rasterPpi, type ExportRequest, type FigureDocumentV1 } from "@panelstudio/contracts";
import { api } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { labelName } from "../model/changes";
import { downloadAgain, exportFigure } from "../state/session";
import { patch, useWorkspace, useWorkspaceFields } from "../state/store";
import type { Confirmed } from "../state/types";
import { Shell } from "./DialogShell";
import { Button, Icon, TabBar } from "./widgets";

export function ExportDialog({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const state = useWorkspaceFields("projectId", "exportState", "title", "cards", "draft");
  const [format, setFormat] = useState<"svg" | "png" | "project">("svg");
  const [metadata, setMetadata] = useState(true);
  const [dpi, setDpi] = useState<(typeof PNG_DPI_OPTIONS)[number]>(DEFAULT_PNG_DPI);
  const [fonts, setFonts] = useState(true);
  const [source, setSource] = useState<Confirmed | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const { confirmed, exportState } = useWorkspace.getState();
    setSource(exportState?.status === "running" ? exportState.source : confirmed);
    setFormat(exportState?.status === "running" ? exportState.request.format : "svg");
  }, [open, state.projectId]);
  const revision = source?.revision ?? 0;
  const running = state.exportState?.status === "running";
  function changeOption(update: () => void) {
    if (useWorkspace.getState().exportState?.status === "running") return;
    patch({ exportState: null });
    update();
  }
  const request = (): ExportRequest => format === "svg" ? { revision, format, options: { includeMetadata: metadata } }
    : format === "png" ? { revision, format, options: { dpi } } : { revision, format, options: { includeBundledFonts: fonts } };
  return <Shell open={open} title={t("export.title")} className="export-dialog">
    <p className="export-context" data-testid="export-revision">{state.title} · {t("export.revision", { revision })}</p>
    {state.cards.length > 0 && <p className="export-advice" role="status">{t("export.pendingDraft", { revision })}</p>}
    {state.draft && <div className="export-advice"><p>{t("export.unsaved")}</p><Button action="export-recover" variant="quiet" onClick={() => patch({ dialog: "recovery" })}>{t("save.retry")}</Button></div>}
    <TabBar id="export-format" label={t("export.format")} value={format} onChange={value => { if (value !== format) changeOption(() => setFormat(value)); }} items={(["svg", "png", "project"] as const).map(value => ({value, action:"format-" + value, label:value === "project" ? t("export.project") : value.toUpperCase(), disabled:running}))} />
    <div className="export-format-content" role="tabpanel" id="export-format-panel" aria-labelledby={"export-format-" + format}>
      {format === "svg" && <><p>{t("export.editableDetail")}</p><label className="check"><input type="checkbox" checked={metadata} disabled={running} onChange={event => changeOption(() => setMetadata(event.target.checked))} />{t("export.includeMetadata")}</label></>}
      {format === "png" && <><label className="field"><span>{t("export.dpi")}</span><select value={dpi} disabled={running} onChange={event => changeOption(() => setDpi(Number(event.target.value) as typeof dpi))}>
        {PNG_DPI_OPTIONS.map(option => <option key={option} value={option}>{option} DPI</option>)}</select></label>
        {source && <p className="numeric-text">{t("export.dimensions", { width: pngPixelsFromMm(source.document.canvas.widthMm, dpi), height: pngPixelsFromMm(source.document.canvas.heightMm, dpi) })}</p>}</>}
      {format === "project" && <><p>{t("export.packageDetail")}</p><label className="check"><input type="checkbox" checked={fonts} disabled={running} onChange={event => changeOption(() => setFonts(event.target.checked))} />{t("export.includeFonts")}</label></>}
      {open && source && state.projectId && <RasterQuality projectId={state.projectId} document={source.document} />}
      <details className="export-font-details" open={format === "svg"}><summary>{t("export.fontDetails")}</summary>
        <p data-testid="font-status">{BUNDLED_FONTS.map(font => font.family).join(" / ")}</p><p>{t("export.fontAdvice")}</p>
        <a className="button quiet" data-action="download-fonts" href="/api/v1/fonts/bundle" download="panelstudio-fonts.zip">{t("export.downloadFonts")}<Icon name="import" /></a>
      </details>
    </div>
    {state.exportState?.status === "running" && <p role="status" data-testid="export-phase">{t("export.running", { revision: state.exportState.request.revision, phase: state.exportState.phase })}</p>}
    {state.exportState?.status === "ready" && <div className="export-result" role="status"><strong>{state.exportState.filename}</strong>
      <Button action="download-again" variant="quiet" onClick={() => void downloadAgain()}>{t("export.downloadAgain")}</Button>
      <ul data-testid="export-diagnostics">{state.exportState.diagnostics.map((item, index) => <li key={index}>{formatDiagnostic(t, item)}</li>)}</ul></div>}
    {state.exportState?.status === "failed" && <p role="alert" className="field-error">{state.exportState.message}</p>}
    <div className="dialog-actions export-actions"><Button action="export-close" variant="quiet" onClick={() => patch({ dialog: null })}>{t("layout.cancel")}</Button>
      <Button action={"export-" + format} variant="primary" disabledReason={running ? t("layout.loading") : !source ? t("app.noProject") : undefined} onClick={() => { if (source) void exportFigure(request(), source); }}><Icon name="export" />{t("export." + format)}</Button></div>
  </Shell>;
}

function RasterQuality({ projectId, document }: { projectId: string; document: FigureDocumentV1 }) {
  const { t } = useTranslation();
  const assets = useQuery({ queryKey: ["assets", projectId], queryFn: () => api.assets(projectId) });
  if (document.panelOrder.length === 0) return null;
  if (!assets.data) return <p role="status">{t(assets.isError ? "export.qualityUnavailable" : "export.qualityLoading")}</p>;
  const target = document.layoutSettings.targetRasterPpi;
  const rows = document.panelOrder.flatMap(id => {
    const panel = document.panels[id]!;
    const asset = assets.data.items.find(item => item.id === panel.assetId);
    if (asset?.normalized?.renderMediaType === "image/svg+xml") return [];
    const pixels = asset?.normalized?.rasterPixelSize;
    const ppi = pixels ? rasterPpi(panel.frameMm.width, panel.cropNormalized.width, pixels.width) : null;
    return [{ id, label: labelName(document, id), filename: asset?.originalFilename ?? panel.name, ppi }];
  });
  const hasSvg = rows.length < document.panelOrder.length;
  if (!rows.length) return <p className="export-quality-scope">{t("export.rasterScope")}</p>;
  const low = (ppi: number) => ppi + 1e-6 < target;
  return <details className="export-quality" data-testid="export-quality" open={rows.some(row => row.ppi === null || low(row.ppi))}>
    <summary>{t("export.sourcePpi", { target })}</summary>
    <ul>{rows.map(row => <li key={row.id}>
      <span><strong>{row.label}</strong> · {row.filename}</span>
      <span>{row.ppi === null ? t("export.ppiUnknown") : t(low(row.ppi) ? "export.ppiLow" : "export.ppiValue", { ppi: Number(row.ppi.toFixed(1)) })}</span>
    </li>)}</ul>
    {hasSvg && <p className="export-quality-scope">{t("export.rasterScope")}</p>}
  </details>;
}
