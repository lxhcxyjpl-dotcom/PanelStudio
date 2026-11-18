import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { Asset } from "@panelstudio/contracts";
import { api, thumbnailUrl } from "../api/client";
import { formatDiagnostic } from "../i18n/diagnostic";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { clickedSelection, groupForPanel } from "../model/document-ui";
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
import { Button, Icon, TabBar } from "./widgets";

export function LeftSidebar() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const tab = state.assetTab;
  const setTab = (assetTab: "assets" | "panels") => patch({ assetTab });
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const width = sidebarWidth("left", state.mode, state.leftWidth);
  const assets = useQuery({
    queryKey: ["assets", state.projectId],
    enabled: Boolean(state.projectId),
    queryFn: () => api.assets(state.projectId ?? ""),
  });
  const document = baseDocument(state);
  const visible = (assets.data?.items ?? []).filter((asset) => !asset.removedFromLibraryAt &&
    !(asset.status === "failed" && state.imports.some(row => row.status === "failed" && row.filename === asset.originalFilename)));
  const completed = state.imports.filter((row) => row.status === "ready").length;
  const pending = state.imports.filter((row) => row.status !== "ready");
  return (
    <aside
      className="sidebar left-sidebar" id="studio-assets"
      data-testid="left-sidebar"
      data-open={state.leftOpen ? "true" : "false"}
      style={{ width }}
      aria-label={t("a11y.left")}
    >
      <TabBar id="asset-tabs" value={tab} onChange={setTab} label={t("a11y.left")} items={[
        { value: "assets", label: assets.data ? t("assets.tabCount", { count: visible.length }) : t("assets.tab"), action: "tab-assets" },
        { value: "panels", label: t("panels.tab"), action: "tab-panels" },
      ]} />
      <Button action="close-assets" className="drawer-close" variant="quiet" aria-label={t("a11y.close")}
        onClick={() => patch({leftOpen:false})}><Icon name="close" /></Button>
      <div className="side-scroll" role="tabpanel" id="asset-tabs-panel" aria-labelledby={"asset-tabs-" + tab}>
        {tab === "assets" ? (
          <section className="section asset-library">
            {completed > 0 && <p className="import-summary" role="status"><Icon name="check" />{t("assets.importedCount",{count:completed})}</p>}
            {pending.length > 0 ? (
              <ul className="import-log">
                {pending.map((row) => (
                  <li key={row.id} data-status={row.status}>
                    <strong>{row.filename}</strong>
                    <span>
                      {row.status === "importing" ? t("assets.importing", { name: row.filename }) : row.message}
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
    <article className="asset-card" data-used={count > 0}>
      <div className="thumb">
        {projectId && asset.status === "ready" ? (
          <img alt="" src={`/api/v1/projects/${projectId}/assets/${asset.id}/thumbnail`} />
        ) : (
          <span>{format}</span>
        )}
        {asset.status === "ready" && count > 0 && <span className="asset-use" title={t("assets.used", { count })} aria-label={t("assets.used", { count })}><Icon name="check" />{count > 1 ? count : null}</span>}
      </div>
      <div className="asset-copy">
        <strong title={asset.originalFilename}>{asset.originalFilename}</strong>
        <span title={format + " · " + size}>{size}</span>
        {asset.status !== "ready" && <span className="asset-status">{t(asset.status === "failed" ? "assets.failed" : "assets.processing")}</span>}
      </div>
      <div className="asset-tools">
        <Button action="add-asset" variant="quiet" aria-label={t("assets.add")} title={t("assets.add")}
          disabledReason={asset.status === "ready" ? undefined : t("assets.processing")} onClick={() => void offerAssets([asset.id])}><Icon name="plus" /></Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild><Button action="asset-menu" variant="quiet" aria-label={t("assets.actions",{name:asset.originalFilename})} title={t("toolbar.more")}><Icon name="more" /></Button></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={4}>
              <DropdownMenu.Item className="menu-item" data-action="asset-info" onSelect={() => patch({dialog:"asset",assetInfoId:asset.id})}>{t("assets.info")}</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" data-action="download-original" onSelect={() => void downloadOriginal(asset.id)}>{t("assets.download")}</DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" data-action="remove-asset" disabled={count > 0} title={count > 0 ? t("assets.removeReasonUsed") : undefined}
                onSelect={() => void removeAsset(asset.id)}>{t("assets.remove")}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {asset.diagnostics.length > 0 && <span className="asset-diagnostic">{asset.diagnostics.map((item) => formatDiagnostic(t, item)).join(" ")}</span>}
    </article>
  );
}

function PanelList({ openPanels, onToggle }: { openPanels: Record<string, boolean>; onToggle: (panelId: string) => void }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const document = baseDocument(state);
  const [dragId, setDragId] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const pointerY = useRef<number | null>(null);
  useEffect(() => {
    if (!dragId) return;
    let frame = 0;
    const scroll = () => {
      const node = list.current?.closest(".side-scroll");
      if (node instanceof HTMLElement && pointerY.current !== null) {
        const box = node.getBoundingClientRect(), y = pointerY.current;
        const delta = y < box.top + 32 ? -7 : y > box.bottom - 32 ? 7 : 0;
        if (delta) node.scrollTop += delta;
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragId]);
  function clear() { setDragId(null); setSlot(null); pointerY.current = null; }
  async function move(id: string, insertion: number) {
    if (!document) return;
    const previous = document.panelOrder, from = previous.indexOf(id);
    if (from < 0) return;
    const next = previous.filter((panelId) => panelId !== id);
    const at = Math.max(0, Math.min(next.length, insertion > from ? insertion - 1 : insertion));
    next.splice(at, 0, id);
    if (at === from) return;
    await reorderLabels(next);
    const current = useWorkspace.getState();
    if (current.projectId !== state.projectId || current.confirmed?.document.panelOrder[at] !== id) return;
    list.current?.querySelector<HTMLButtonElement>(`[data-handle-id="${id}"]`)?.focus();
    patch({ liveMessage: t("panels.reordered", { name: document.panels[id]?.name, position: at + 1, count: next.length }) });
  }
  function insertionAt(event: DragEvent<HTMLElement>, index: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return index + Number(event.clientY >= rect.top + rect.height / 2);
  }
  if (!document || document.panelOrder.length === 0) return <p className="muted section">{t("panels.empty")}</p>;
  return (
    <div
      className="panel-list"
      role="listbox"
      aria-label={t("panels.tab")}
      data-keys="list"
      ref={list} onDragEnd={clear}
      onKeyDown={(event) => {
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        const handle = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-handle-id]") : null;
        const id = handle?.dataset.handleId ?? (state.selection.kind === "panels" ? state.selection.ids[0] : undefined);
        if (!id) return;
        event.preventDefault(); event.stopPropagation();
        const index = document.panelOrder.indexOf(id);
        void move(id, index + (event.key === "ArrowUp" ? -1 : 2));
      }}
    >
      {document.panelOrder.map((panelId, index) => {
        const panel = document.panels[panelId];
        if (!panel) return null;
        const label = resolvePanelLabel(document, panelId);
        const selected = (state.selection.kind === "panels" && state.selection.ids.includes(panelId)) || (state.selection.kind === "group" && groupForPanel(document, panelId)?.id === state.selection.groupId);
        const expanded = openPanels[panelId] === true;
        return (
          <div key={panelId} className="panel-block" data-drag-source={dragId === panelId}
            data-insert={slot === index ? "before" : index === document.panelOrder.length - 1 && slot === index + 1 ? "after" : undefined}
            onDragOver={(event) => {
              if (!dragId) return;
              event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
              pointerY.current = event.clientY;
              setSlot(insertionAt(event, index));
            }}
            onDrop={(event) => {
              if (!dragId) return;
              event.preventDefault(); event.stopPropagation();
              void move(dragId, insertionAt(event, index)); clear();
            }}>
            <div className="panel-row" role="option" aria-selected={selected} data-testid="panel-row" onClick={(event) => patch({ selection: clickedSelection(document, state.selection, panelId, event.shiftKey) })}>
              <button
                type="button"
                className="drag-handle"
                data-action="reorder-labels"
                data-handle-id={panelId} draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-panelstudio-order", panelId);
                  const row = event.currentTarget.closest(".panel-row");
                  if (row) event.dataTransfer.setDragImage(row, 12, 16);
                  setDragId(panelId); setSlot(index);
                }}
                aria-label={t("panels.reorder")}
                title={t("panels.reorder")}
              >
                ≡
              </button>
              {state.projectId ? <img className="row-thumb" alt="" draggable={false} src={thumbnailUrl(state.projectId, panel.assetId)} /> : null}
              <span className="row-label">{label?.text ?? "–"}</span>
              <span className="row-name" title={panel.name}>{panel.name}</span>
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
                    <Icon name="more" />
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
