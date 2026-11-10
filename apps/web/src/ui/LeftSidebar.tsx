import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Asset } from "@panelstudio/contracts";
import { api } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { groupForPanel } from "../model/document-ui";
import { sidebarWidth } from "../model/chrome";
import {
  downloadOriginal,
  moveStack,
  offerAssets,
  removeAsset,
  reorderLabels,
  transact,
} from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { baseDocument } from "../state/types";
import { Button, Icon } from "./widgets";

export function LeftSidebar() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [tab, setTab] = useState<"assets" | "panels">("assets");
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const width = sidebarWidth("left", state.mode, state.leftWidth);
  const assets = useQuery({
    queryKey: ["assets", state.projectId],
    enabled: Boolean(state.projectId),
    queryFn: () => api.assets(state.projectId ?? ""),
  });
  const document = baseDocument(state);
  const visible = (assets.data?.items ?? []).filter((asset) => !asset.removedFromLibraryAt);
  return (
    <aside
      className="sidebar left-sidebar"
      data-testid="left-sidebar"
      data-open={state.leftOpen ? "true" : "false"}
      style={{ width }}
      aria-label={t("a11y.left")}
    >
      <div className="tabs" role="tablist">
        <button type="button" data-action="tab-assets" role="tab" aria-selected={tab === "assets"} onClick={() => setTab("assets")}>
          {t("assets.tab")}
        </button>
        <button type="button" data-action="tab-panels" role="tab" aria-selected={tab === "panels"} onClick={() => setTab("panels")}>
          {t("panels.tab")}
        </button>
      </div>
      <div className="side-scroll">
        {tab === "assets" ? (
          <section className="section">
            {state.imports.length > 0 ? (
              <ul className="import-log">
                {state.imports.map((row) => (
                  <li key={row.id} data-status={row.status}>
                    <strong>{row.filename}</strong>
                    <span>
                      {row.status === "importing"
                        ? t("assets.importing", { name: row.filename })
                        : row.status === "ready"
                          ? t("assets.imported", { name: row.filename })
                          : row.message}
                    </span>
                    {row.code === "SVG_UNSUPPORTED_FEATURE" ? (
                      <Button action="svg-help" onClick={() => patch({ dialog: "svg" })}>
                        {t("assets.formatHelp")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {visible.length === 0 ? <p className="muted">{t("assets.empty")}</p> : null}
            {visible.map((asset) => (
              <AssetCard key={asset.id} asset={asset} count={useCount(document, asset.id)} />
            ))}
          </section>
        ) : (
          <PanelList openPanels={openPanels} onToggle={(panelId) => setOpenPanels((current) => ({ ...current, [panelId]: !current[panelId] }))} />
        )}
      </div>
    </aside>
  );
}

function AssetCard({ asset, count }: { asset: Asset; count: number }) {
  const { t } = useTranslation();
  const projectId = useWorkspace((item) => item.projectId);
  const format = asset.originalMediaType === "image/png" ? "PNG" : asset.originalMediaType === "image/jpeg" ? "JPEG" : asset.originalMediaType === "image/webp" ? "WebP" : "SVG";
  const size = asset.status === "ready" && asset.normalized
    ? asset.normalized.rasterPixelSize
      ? `${asset.normalized.rasterPixelSize.width}×${asset.normalized.rasterPixelSize.height} px`
      : `${Math.round(asset.normalized.viewport.width)}×${Math.round(asset.normalized.viewport.height)}`
    : "—";
  return (
    <article className="asset-card">
      <div className="thumb">
        {projectId && asset.status === "ready" ? (
          <img alt="" src={`/api/v1/projects/${projectId}/assets/${asset.id}/thumbnail`} />
        ) : (
          <span>{format}</span>
        )}
      </div>
      <div className="asset-copy">
        <strong title={asset.originalFilename}>{asset.originalFilename}</strong>
        <span>{format}</span>
        <span>{t("assets.original")} {size}</span>
        <span>{asset.status === "ready" ? t("assets.ready") : asset.status === "failed" ? t("assets.failed") : t("assets.processing")}</span>
        <span>{t("assets.used", { count })}</span>
        {asset.diagnostics.length > 0 ? <span className="marker">{asset.diagnostics.map((item) => formatDiagnostic(t, item)).join(" ")}</span> : null}
      </div>
      <div className="asset-actions">
        <Button action="add-asset" disabledReason={asset.status === "ready" ? undefined : t("assets.processing")} onClick={() => void offerAssets([asset.id])}>
          {t("assets.add")}
        </Button>
        <Button action="download-original" onClick={() => void downloadOriginal(asset.id)}>
          {t("assets.download")}
        </Button>
        <Button action="asset-info" onClick={() => patch({ dialog: "asset", assetInfoId: asset.id })}>
          {t("assets.info")}
        </Button>
        <Button action="remove-asset" disabledReason={count > 0 ? t("assets.removeReasonUsed") : undefined} onClick={() => void removeAsset(asset.id)}>
          {t("assets.remove")}
        </Button>
      </div>
    </article>
  );
}

function PanelList({ openPanels, onToggle }: { openPanels: Record<string, boolean>; onToggle: (panelId: string) => void }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const document = baseDocument(state);
  if (!document || document.panelOrder.length === 0) return <p className="muted section">{t("panels.empty")}</p>;
  return (
    <div
      className="panel-list"
      role="listbox"
      aria-label={t("panels.tab")}
      data-keys="list"
      onKeyDown={(event) => {
        const index = document.panelOrder.findIndex((id) => state.selection.kind === "panels" && state.selection.ids[0] === id);
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && index >= 0) {
          event.preventDefault();
          event.stopPropagation();
          const next = [...document.panelOrder];
          const swap = event.key === "ArrowUp" ? index - 1 : index + 1;
          const current = next[index];
          const other = next[swap];
          if (current === undefined || other === undefined) return;
          next[index] = other;
          next[swap] = current;
          void reorderLabels(next);
        }
      }}
    >
      {document.panelOrder.map((panelId) => {
        const panel = document.panels[panelId];
        if (!panel) return null;
        const label = resolvePanelLabel(document, panelId);
        const selected = (state.selection.kind === "panels" && state.selection.ids.includes(panelId)) || (state.selection.kind === "group" && groupForPanel(document, panelId)?.id === state.selection.groupId);
        const expanded = openPanels[panelId] === true;
        return (
          <div key={panelId} className="panel-block">
            <div className="panel-row" role="option" aria-selected={selected} data-testid="panel-row" onClick={() => patch({ selection: { kind: "panels", ids: [panelId] } })}>
              <button
                type="button"
                className="drag-handle"
                data-action="reorder-labels"
                aria-label={t("panels.reorder")}
                title={t("panels.reorder")}
              >
                ≡
              </button>
              <span className="row-thumb" />
              <span className="row-label">{label?.text ?? "–"}</span>
              <span className="row-name">{panel.name}</span>
              <Button
                action="expand-panel"
                aria-label={expanded ? t("panels.collapse") : t("panels.expand")}
                aria-expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle(panelId);
                }}
              >
                <Icon name="chevron" />
              </Button>
              <Button
                action="toggle-lock"
                aria-label={panel.locked ? t("panels.unlock") : t("panels.lock")}
                onClick={(event) => {
                  event.stopPropagation();
                  void transact([{ type: "panel.setLocked", panelIds: [panelId], locked: !panel.locked }]);
                }}
              >
                <Icon name={panel.locked ? "lock" : "unlock"} />
              </Button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button action="stack-menu" aria-label={t("panels.stack")} onClick={(event) => event.stopPropagation()}>
                    <Icon name="chevron" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="menu" sideOffset={4}>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void moveStack(panelId, "front")}>{t("panels.front")}</DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void moveStack(panelId, "forward")}>{t("panels.forward")}</DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void moveStack(panelId, "backward")}>{t("panels.backward")}</DropdownMenu.Item>
                    <DropdownMenu.Item className="menu-item" onSelect={() => void moveStack(panelId, "back")}>{t("panels.back")}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {expanded ? <div className="panel-sub">
              <button type="button" data-action="select-image" onClick={() => patch({ selection: { kind: "panels", ids: [panelId] } })}>
                {t("panels.image")}
              </button>
              <button type="button" data-action="select-label-row" onClick={() => patch({ selection: { kind: "label", panelId } })}>
                {t("panels.label")}
              </button>
            </div> : null}
          </div>
        );
      })}
    </div>
  );
}

function useCount(document: ReturnType<typeof baseDocument>, assetId: string): number {
  if (!document) return 0;
  return Object.values(document.panels).filter((panel) => panel.assetId === assetId).length;
}
