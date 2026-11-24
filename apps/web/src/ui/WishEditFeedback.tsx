import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset, FigureDocumentV1 } from "@panelstudio/contracts";
import type { TFunction } from "i18next";
import type { ProposalChange } from "../model/changes";
import { clickedSelection } from "../model/document-ui";
import { centerFrameCamera } from "../model/view";
import { undoWishEdit } from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { isCurrentWishEdit, type WishEditFeedback as EditFeedback } from "../state/wish-session";

function changeText(t: TFunction, change: ProposalChange, assets: Asset[]): string {
  switch (change.kind) {
    case "size":
      return t("wish.edit.size", { before: change.before.replace("×", " × "), after: change.after.replace("×", " × ") });
    case "move": {
      const x = change.dx && t(change.dx > 0 ? "wish.edit.right" : "wish.edit.left", { distance: Math.abs(change.dx) });
      const y = change.dy && t(change.dy > 0 ? "wish.edit.down" : "wish.edit.up", { distance: Math.abs(change.dy) });
      return [x, y].filter(Boolean).join(t("wish.edit.separator")) || t("wish.edit.move");
    }
    case "replace": {
      const before = assets.find(asset => asset.id === change.before)?.originalFilename;
      const after = assets.find(asset => asset.id === change.after)?.originalFilename;
      return before && after ? t("wish.edit.replacedFiles", { before, after }) : t("wish.edit.replace");
    }
    case "canvas":
      return t("wish.edit.canvas", change);
    case "gutter":
      return t("ai.changeGutter", change);
    case "lock":
      return t(change.locked ? "wish.edit.lock" : "wish.edit.unlock", { label: change.panelId ? "" : change.label });
    case "labelSize":
    case "labelColor":
    case "order":
      return t("refine." + change.kind, change);
    case "labelVisibility":
      return t(change.visible ? "wish.edit.labelShown" : "wish.edit.labelHidden");
    case "canvasSettings":
      return t("ai.changeCanvasSettings");
    case "layoutSettings":
      return t("ai.changeLayoutSettings");
    default:
      return t("wish.edit." + change.kind, change);
  }
}

function groupChanges(changes: ProposalChange[], focusPanelId?: string) {
  const groups = new Map<string | null, { panelId: string | null; label: string; changes: ProposalChange[] }>();
  for (const change of changes) {
    const panelId = "panelId" in change ? change.panelId ?? null : null;
    const group = groups.get(panelId);
    if (group) group.changes.push(change);
    else groups.set(panelId, { panelId, label: panelId && "label" in change ? change.label ?? "" : "", changes: [change] });
  }
  const priority = (group: { panelId: string | null; changes: ProposalChange[] }) =>
    group.panelId === focusPanelId ? 0 : group.changes.some(change => change.kind === "replace") ? 1 : group.panelId ? 2 : 3;
  return [...groups.values()].sort((a, b) => priority(a) - priority(b));
}

export function WishEditFeedback({ edit, projectId, document, assets, canUndo }: {
  edit: EditFeedback;
  projectId: string;
  document: FigureDocumentV1;
  assets: Asset[];
  canUndo: boolean;
}) {
  const { t } = useTranslation();
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const rows = groupChanges(edit.changes, edit.focusPanelId).map(group => ({
    ...group,
    summary: group.changes.map(change => changeText(t, change, assets)).join(t("wish.edit.separator")),
  }));
  const [first, ...rest] = rows;
  const fallback = t(edit.changed ? "wish.updated" : "wish.edit.none");
  function locate(panelId: string) {
    const state = useWorkspace.getState();
    const current = state.confirmed;
    const frame = current?.document.panels[panelId]?.frameMm;
    if (state.projectId !== projectId || !current || !isCurrentWishEdit(edit, current) || !frame) return;
    patch({
      camera: centerFrameCamera(state.camera, state.viewport, frame),
      selection: clickedSelection(current.document, { kind: "none" }, panelId, false),
    });
  }
  function row({ panelId, label, summary }: (typeof rows)[number]) {
    return <div className="wish-edit-row" key={panelId ?? "figure"}>
      {panelId && (document.panels[panelId]
        ? <button type="button" className="wish-edit-panel" data-action="wish-locate-edit" data-target-panel={panelId}
            title={t("wish.edit.locate", { label })} aria-label={t("wish.edit.locate", { label })}
            onClick={() => locate(panelId)}>{label}</button>
        : <strong className="wish-edit-removed">{label}</strong>)}
      <span className="wish-edit-summary">{summary}</span>
    </div>;
  }
  return (
    <div className="wish-edit-feedback" data-testid="wish-edit-feedback">
      <span className="sr-only" role="status">
        {first ? [first.label, first.summary].filter(Boolean).join(" ") : fallback}
      </span>
      <div className="wish-edit-line">
        {first ? row(first) : <p>{fallback}</p>}
        {!!rest.length && <button type="button" className="wish-edit-more" aria-controls={expanded ? detailsId : undefined}
          aria-expanded={expanded} aria-label={t(expanded ? "wish.edit.less" : "wish.edit.more", { count: rest.length })}
          onClick={() => setExpanded(!expanded)}>{expanded ? t("wish.edit.less") : "+" + rest.length}</button>}
        {edit.changed && <button type="button" className="wish-edit-undo" data-action="wish-undo-edit" disabled={!canUndo}
          onClick={() => void undoWishEdit(projectId, edit)}>{t("toolbar.undo")}</button>}
      </div>
      {expanded && <div className="wish-edit-details" id={detailsId}>{rest.map(row)}</div>}
    </div>
  );
}
