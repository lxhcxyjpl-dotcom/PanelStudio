import { useTranslation } from "react-i18next";
import { memo } from "react";
import { actualSize, fitCamera, zoomAt } from "../model/view";
import { redo, undo } from "../state/session";
import { patch, useWorkspaceFields } from "../state/store";
import { Button, Icon } from "./widgets";

export const CanvasTools = memo(function CanvasTools({ widthMm, heightMm }: { widthMm: number; heightMm: number }) {
  const { t, i18n } = useTranslation();
  const state = useWorkspaceFields("camera", "viewport", "compareMode", "confirmed", "leftOpen", "rightOpen");
  const { camera, viewport } = state;
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  return <div className="canvas-tools">
    <Button action="drawer-assets" variant="quiet" className="drawer-toggle" aria-label={t("assets.tab")} aria-expanded={state.leftOpen}
      aria-controls="studio-assets" onClick={() => patch({ leftOpen: !state.leftOpen, rightOpen: false })}><Icon name="layers" /></Button>
    <div className="board-info"><Icon name="reference" /><strong>{t(state.compareMode === "editing" ? "inspector.canvas" : "layout.preview")}</strong>
      <span>{number.format(widthMm)} × {number.format(heightMm)} mm</span></div>
    <div className="view-controls">
      <Button variant="quiet" action="undo" aria-label={t("toolbar.undo")} title={t("toolbar.undo")} disabledReason={state.confirmed?.history.canUndo ? undefined : t("history.undoEmpty")} onClick={() => void undo()}><Icon name="undo" /></Button>
      <Button variant="quiet" action="redo" aria-label={t("toolbar.redo")} title={t("toolbar.redo")} disabledReason={state.confirmed?.history.canRedo ? undefined : t("history.redoEmpty")} onClick={() => void redo()}><Icon name="redo" /></Button>
      <span className="control-rule" aria-hidden="true" />
      <Button variant="quiet" action="zoom-out" aria-label={t("canvas.zoomOut")} title={t("canvas.zoomOut")} onClick={() => patch({camera:zoomAt(camera, 1/1.1, center)})}><Icon name="minus" /></Button>
      <Button variant="quiet" action="actual-size" className="zoom-readout" aria-label={t("canvas.actual")} title={t("canvas.actual")}
        onClick={() => patch({camera:actualSize(camera, viewport)})}>{Math.round(camera.zoom*100)}%</Button>
      <Button variant="quiet" action="zoom-in" aria-label={t("canvas.zoomIn")} title={t("canvas.zoomIn")} onClick={() => patch({camera:zoomAt(camera, 1.1, center)})}><Icon name="plus" /></Button>
      <Button variant="quiet" action="fit" aria-label={t("canvas.fit")} title={t("canvas.fit")}
        onClick={() => patch({camera:fitCamera(viewport,{width:widthMm,height:heightMm})})}><Icon name="fit" /></Button>
    </div>
    <Button action="drawer-inspector" variant="quiet" className="drawer-toggle" aria-label={t("inspector.tab")} aria-expanded={state.rightOpen}
      aria-controls="studio-inspector" onClick={() => patch({ rightOpen: !state.rightOpen, leftOpen: false })}><Icon name="sliders" /></Button>
  </div>;
});
