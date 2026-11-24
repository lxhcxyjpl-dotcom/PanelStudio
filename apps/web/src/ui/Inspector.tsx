import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ARTWORK_COLOR_PRESETS,
  BUNDLED_FONTS,
  CANVAS_WIDTH_PRESETS_MM,
  RESOURCE_LIMITS,
  resolveLabelText,
  type FigureDocumentV1,
  type LabelOverrides,
} from "@panelstudio/contracts";
import { scalePanel, translateSelection } from "@panelstudio/core/arrange";
import { DocumentCommandError } from "@panelstudio/core/apply";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { ApiClientError } from "../api/client";
import { labelName } from "../model/changes";
import { errorText } from "../model/feedback";
import { sidebarWidth } from "../model/chrome";
import { cropInvalid, geometryLocked, mergedOverrides } from "../model/document-ui";
import {
  align,
  continueEditing,
  createGroup,
  dissolveGroup,
  distribute,
  enterCrop,
  equalSize,
  requestLayout,
  resizeCanvas,
  restoreFullCrop,
  selectCandidate,
  transact,
  updateCrop,
} from "../state/session";
import { patch, useWorkspace, useWorkspaceFields } from "../state/store";
import { baseDocument, candidatesStale } from "../state/types";
import { AiPanel } from "./AiPanel";
import { ArrangeInspector } from "./ArrangeInspector";
import { CropActions } from "./CropActions";
import { LocalRow } from "./LocalRow";
import { Button, Icon, NumberField, SelectField, TabBar, TextField } from "./widgets";

export function Inspector() {
  const { t } = useTranslation();
  const state = useWorkspaceFields(
    "inspectorMode", "mode", "rightWidth", "rightOpen", "compareMode", "candidateRoot", "activeCandidateId", "cards",
  );
  const tab = state.inspectorMode;
  const setTab = (inspectorMode: typeof tab) => {
    if (inspectorMode === "layout" && state.compareMode === "editing" && state.activeCandidateId && !candidatesStale(useWorkspace.getState())) {
      selectCandidate(state.activeCandidateId);
    }
    patch({ inspectorMode });
  };
  const width = sidebarWidth("right", state.mode, state.rightWidth);
  const previewing = state.compareMode !== "editing";
  const hasLayouts = tab === "layout" || state.cards.some(card => card.candidate.origin !== "ai");
  const phoneHeading = state.mode === "phone" && !hasLayouts;
  const base = useWorkspace(baseDocument);
  const document = state.compareMode === "original" ? state.candidateRoot?.document ?? base
    : state.compareMode === "draft" ? state.cards.find(card => card.candidate.id === state.activeCandidateId)?.candidate.previewDocument ?? base
    : base;
  return (
    <aside
      className="sidebar right-sidebar" id="studio-inspector"
      data-testid="right-sidebar"
      data-open={state.rightOpen ? "true" : "false"}
      style={{ width }}
      aria-label={t("a11y.right")}
    >
      {phoneHeading ? <h2 className="drawer-heading" id="inspector-drawer-heading" tabIndex={-1} data-drawer-heading>
        {t(tab === "ai" ? "ai.tab" : "inspector.tab")}
      </h2> : <TabBar id="inspector-tabs" value={tab} onChange={setTab} label={t("a11y.right")} items={[
        { value: "properties", label: t("inspector.tab"), action: "tab-properties" }, { value: "ai", label: t("ai.tab"), action: "tab-ai" },
        ...(hasLayouts ? [{ value: "layout" as const, label: t("layout.candidatesTab"), action: "tab-layout" }] : []),
      ]} />}
      <Button action="close-inspector" className="drawer-close" variant="quiet" aria-label={t("a11y.close")}
        onClick={() => patch({rightOpen:false})}><Icon name="close" /></Button>
      <div className={"side-scroll" + (tab === "ai" ? " conversation-scroll" : tab === "layout" ? " layout-scroll" : "")}
        role={phoneHeading ? "region" : "tabpanel"} id="inspector-tabs-panel"
        aria-labelledby={phoneHeading ? "inspector-drawer-heading" : "inspector-tabs-" + tab}>
        {tab === "ai" ? <AiPanel /> : tab === "layout" ? <ArrangeInspector /> : document ? <>
          {previewing && <div className="preview-readonly"><p>{t("inspector.previewReadOnly")}</p><Button action="properties-edit" onClick={continueEditing}>{t("inspector.returnEditing")}</Button></div>}
          <fieldset className="property-content" disabled={previewing}><Properties document={document} /></fieldset>
        </> : <p className="muted section">{t("app.noProject")}</p>}
      </div>
    </aside>
  );
}

function Properties({ document }: { document: FigureDocumentV1 }) {
  const state = useWorkspaceFields("crop", "selection");
  if (state.crop) return <CropFields />;
  if (state.selection.kind === "none") return <CanvasFields document={document} />;
  if (state.selection.kind === "label") return <LabelFields document={document} panelId={state.selection.panelId} />;
  if (state.selection.kind === "group") return <GroupFields document={document} groupId={state.selection.groupId} />;
  if (state.selection.kind === "panels" && state.selection.ids.length > 1) return <MultiFields document={document} ids={state.selection.ids} />;
  const panelId = state.selection.kind === "panels" ? state.selection.ids[0] : undefined;
  if (!panelId || !document.panels[panelId]) return <CanvasFields document={document} />;
  return <PanelFields document={document} panelId={panelId} />;
}

function CanvasDimensions({ document }: { document: FigureDocumentV1 }) {
  const { t } = useTranslation();
  type Dimension = "widthMm" | "heightMm";
  const [rejection, setRejection] = useState<{
    dimension: Dimension; value: number; error: unknown; source: FigureDocumentV1; attempt: number;
  } | null>(null);
  const issue = rejection?.source === document ? rejection : null;
  const error = issue?.error instanceof DocumentCommandError || issue?.error instanceof ApiClientError ? issue.error : null;
  const outside = error?.code === "OUTSIDE_CANVAS";
  const lockedPanels = (error?.details.panelIds ?? []).filter(id => geometryLocked(document, id) === "lock");
  const canReflow = issue?.dimension === "widthMm" && outside &&
    document.panelOrder.length >= RESOURCE_LIMITS.minAutoLayoutPanels;
  const canvas = document.canvas;
  function change(dimension: Dimension, value: number) {
    if (canvas[dimension] === value) { setRejection(null); return; }
    void resizeCanvas(dimension, value, (error, source) => {
      setRejection(previous => ({ dimension, value, error, source, attempt: (previous?.attempt ?? 0) + 1 }));
    });
  }
  return <>
    <div className="preset-row width-presets">
      {CANVAS_WIDTH_PRESETS_MM.map(width => <Button key={width} action={`width-${width}`}
        aria-pressed={canvas.widthMm === width} onClick={() => change("widthMm", width)}>{width} mm</Button>)}
    </div>
    <div className="field-pair">
      <NumberField key={issue?.dimension === "widthMm" ? `width-${issue.attempt}` : "width"} label={t("inspector.width") + " (mm)"}
        value={canvas.widthMm} min={0.1} onCommit={value => change("widthMm", value)} />
      <NumberField key={issue?.dimension === "heightMm" ? `height-${issue.attempt}` : "height"} label={t("inspector.height") + " (mm)"}
        value={canvas.heightMm} min={0.1} onCommit={value => change("heightMm", value)} />
    </div>
    {issue && <div className="field-group canvas-resize-feedback">
      <p role="alert" className="task-warning">{t(issue.dimension === "widthMm" ? "inspector.widthRejected" : "inspector.heightRejected",
        { value: issue.value, reason: errorText(issue.error) })}</p>
      {outside && lockedPanels.length ? <p>{t("inspector.resizeLocked", {
        panels: lockedPanels.map(id => labelName(document, id)).join(", "),
      })}</p> : canReflow ? <Button action="preview-canvas-width" onClick={() =>
        void requestLayout({ family: "auto", canvasOverride: { widthMm: issue.value } })}>
        {t("inspector.previewWidth", { width: issue.value })}</Button>
        : outside && <p>{t("inspector.resizeManually")}</p>}
    </div>}
  </>;
}

function CanvasFields({ document }: { document: FigureDocumentV1 }) {
  const { t } = useTranslation();
  const canvas = document.canvas;
  const settings = document.layoutSettings;
  const style = document.labelStyle;
  const labelExamples = [0, 1, 2].map(index => resolveLabelText({
    index, sequence: style.sequence, format: style.format, textOverride: null,
  })).join(" ");
  const ungrouped = document.panelOrder.filter((id) => !Object.values(document.groups).some((group) => group.panelIds.includes(id)));
  return (
    <>
      <section className="section canvas-fields">
        <h2 className="inspector-section-title"><Icon name="reference" />{t("inspector.canvas")}</h2>
        <CanvasDimensions document={document} />
        <details className="inspector-disclosure"><summary>{t("inspector.canvasDetails")}<Icon name="chevron" /></summary><div>
        <SelectField
          label={t("inspector.heightMode")}
          value={canvas.heightMode}
          options={[{ value: "auto", label: t("inspector.auto") }, { value: "fixed", label: t("inspector.fixed") }]}
          onChange={(heightMode) => void transact([{ type: "canvas.set", canvas: { ...canvas, heightMode: heightMode === "fixed" ? "fixed" : "auto" } }])}
        />
        <fieldset className="margin-fields"><legend>{t("inspector.margins")} (mm)</legend>
          <NumberField label={t("inspector.top")} value={canvas.marginsMm.top} onCommit={(top) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, top } } }])} />
          <NumberField label={t("inspector.right")} value={canvas.marginsMm.right} onCommit={(right) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, right } } }])} />
          <NumberField label={t("inspector.bottom")} value={canvas.marginsMm.bottom} onCommit={(bottom) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, bottom } } }])} />
          <NumberField label={t("inspector.left")} value={canvas.marginsMm.left} onCommit={(left) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, left } } }])} />
        </fieldset>
        <div className="field canvas-background">
          <span>{t("inspector.background")}</span>
          <span>{t("inspector.backgroundWhite")}</span>
        </div>
        </div></details>
      </section>
      <section className="section canvas-fields">
        <h2 className="inspector-section-title" id="canvas-gutters"><Icon name="layout" />{t("inspector.gutter")} (mm)</h2>
        <div className="field-pair" role="group" aria-labelledby="canvas-gutters">
          <NumberField label={t("inspector.gutterX")} value={settings.gutterMm.horizontal} onCommit={(horizontal) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, gutterMm: { ...settings.gutterMm, horizontal } } }])} />
          <NumberField label={t("inspector.gutterY")} value={settings.gutterMm.vertical} onCommit={(vertical) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, gutterMm: { ...settings.gutterMm, vertical } } }])} />
        </div>
        <SelectField
          label={t("inspector.primary")}
          value={settings.primaryPanelId ?? ""}
          options={[{ value: "", label: t("inspector.none") }, ...ungrouped.map((id) => ({ value: id, label: document.panels[id]?.name ?? id }))]}
          onChange={(value) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, primaryPanelId: value || null } }])}
        />
        <details className="field-group advanced-fields">
          <summary>{t("inspector.limits")}</summary>
          <div className="field-pair">
            <NumberField testId="min-width" label={t("inspector.minSize") + " (mm)"} value={settings.minPanelSizeMm.width} min={0.1} onCommit={(width) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, minPanelSizeMm: { ...settings.minPanelSizeMm, width } } }])} />
            <NumberField label={t("inspector.preferredHeight") + " (mm)"} value={settings.preferredHeightMm} min={0.1} onCommit={(preferredHeightMm) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, preferredHeightMm } }])} />
            <NumberField label={t("inspector.maxHeight") + " (mm)"} value={settings.maxAutoHeightMm} min={0.1} onCommit={(maxAutoHeightMm) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, maxAutoHeightMm } }])} />
            <NumberField label={t("inspector.ppi")} value={settings.targetRasterPpi} min={1} onCommit={(targetRasterPpi) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, targetRasterPpi } }])} />
          </div>
        </details>
      </section>
      <section className="section canvas-fields">
        <details className="inspector-disclosure" data-testid="default-label-settings">
          <summary><span>{t("panels.label")}　{labelExamples} · {style.fontSizePt} pt</span><Icon name="chevron" /></summary>
          <LabelStyleFields style={style} />
        </details>
      </section>
    </>
  );
}

function LabelStyleFields({ style }: { style: FigureDocumentV1["labelStyle"] }) {
  const { t } = useTranslation();
  return (
    <div className="label-settings-grid">
      <SelectField label={t("labels.sequence")} value={style.sequence} options={[{ value: "upper-alpha", label: t("labels.upper") }, { value: "lower-alpha", label: t("labels.lower") }, { value: "number", label: t("labels.number") }]} onChange={(sequence) => void transact([{ type: "label.setStyle", labelStyle: { ...style, sequence: sequence as FigureDocumentV1["labelStyle"]["sequence"] } }])} />
      <SelectField label={t("labels.format")} value={style.format} options={[{ value: "plain", label: t("labels.plain") }, { value: "parentheses", label: t("labels.parentheses") }, { value: "dot", label: t("labels.dot") }]} onChange={(format) => void transact([{ type: "label.setStyle", labelStyle: { ...style, format: format as FigureDocumentV1["labelStyle"]["format"] } }])} />
      <SelectField label={t("labels.font")} value={style.fontId} options={BUNDLED_FONTS.map((font) => ({ value: font.fontId, label: font.family }))} onChange={(fontId) => void transact([{ type: "label.setStyle", labelStyle: { ...style, fontId: fontId as FigureDocumentV1["labelStyle"]["fontId"] } }])} />
      <NumberField testId="label-size" label={t("labels.size") + " (pt)"} value={style.fontSizePt} min={0.1} onCommit={(fontSizePt) => void transact([{ type: "label.setStyle", labelStyle: { ...style, fontSizePt } }])} />
      <SelectField label={t("labels.weight")} value={String(style.fontWeight)} options={[{ value: "400", label: t("labels.regular") }, { value: "700", label: t("labels.bold") }]} onChange={(fontWeight) => void transact([{ type: "label.setStyle", labelStyle: { ...style, fontWeight: fontWeight === "700" ? 700 : 400 } }])} />
      <ColorField label={t("labels.color")} value={style.color} onCommit={(color) => void transact([{ type: "label.setStyle", labelStyle: { ...style, color } }])} />
      <SelectField label={t("labels.placement")} value={style.placement} options={[{ value: "outside-top-left", label: t("labels.outside") }, { value: "inside-top-left", label: t("labels.inside") }]} onChange={(placement) => void transact([{ type: "label.setStyle", labelStyle: { ...style, placement: placement as FigureDocumentV1["labelStyle"]["placement"] } }])} />
      <NumberField label={t("labels.gap") + " (mm)"} value={style.gapMm} onCommit={(gapMm) => void transact([{ type: "label.setStyle", labelStyle: { ...style, gapMm } }])} />
    </div>
  );
}

function PanelFields({ document, panelId }: { document: FigureDocumentV1; panelId: string }) {
  const { t } = useTranslation();
  const panel = document.panels[panelId];
  if (!panel) return null;
  const blocked = geometryLocked(document, panelId);
  const reason = blocked === "group" ? t("inspector.disabledGroup") : blocked === "lock" ? t("inspector.disabledLock") : undefined;
  return (
    <><section className="section panel-properties">
      <h2>{panel.name}</h2>
      <TextField label={t("panels.name")} value={panel.name} onCommit={(name) => void transact([{ type: "panel.rename", panelId, name }])} />
      <div className="field-pair">
      <NumberField label="X (mm)" value={panel.frameMm.x} disabledReason={reason} onCommit={(x) => void transact([translateSelection(document, [panelId], x - panel.frameMm.x, 0)])} />
      <NumberField label="Y (mm)" value={panel.frameMm.y} disabledReason={reason} onCommit={(y) => void transact([translateSelection(document, [panelId], 0, y - panel.frameMm.y)])} />
      </div><div className="field-pair">
      <NumberField label={t("inspector.width") + " (mm)"} value={panel.frameMm.width} min={0.1} disabledReason={reason} onCommit={(width) => void transact([scalePanel(document, panelId, { width }, "top-left")])} />
      <NumberField label={t("inspector.height") + " (mm)"} value={panel.frameMm.height} min={0.1} disabledReason={reason} onCommit={(height) => void transact([scalePanel(document, panelId, { height }, "top-left")])} />
      </div><p className="panel-proportion"><Icon name="lock" />{t("inspector.proportion")} · {(panel.frameMm.width / panel.frameMm.height).toFixed(2)} : 1</p><div className="panel-actions">
      <Button action="enter-crop" disabledReason={reason} onClick={() => enterCrop(panelId)}>{t("inspector.crop")}</Button>
      <Button action="panel-lock" onClick={() => void transact([{ type: "panel.setLocked", panelIds: [panelId], locked: !panel.locked }])}>
        {panel.locked ? t("panels.unlock") : t("panels.lock")}
      </Button>
      <Button action="select-its-label" onClick={() => patch({ selection: { kind: "label", panelId } })}>{t("labels.edit")}</Button>
      </div></section></>
  );
}

function LabelFields({ document, panelId }: { document: FigureDocumentV1; panelId: string }) {
  const { t } = useTranslation();
  const panel = document.panels[panelId];
  if (!panel) return null;
  const overrides = panel.labelOverrides;
  const resolved = resolvePanelLabel(document, panelId);
  const offset = overrides.offsetMm ?? { x: (resolved?.x ?? panel.frameMm.x) - panel.frameMm.x, y: (resolved?.y ?? panel.frameMm.y) - panel.frameMm.y };
  return (
    <section className="section">
      <h2>{t("labels.this")}</h2>
      <TextField
        label={t("labels.content")}
        placeholder={t("labels.automatic")}
        value={overrides.text ?? ""}
        onCommit={(text) => void transact([{ type: "label.setOverrides", items: [{ panelId, value: mergedOverrides(overrides, { text: text.trim() ? text : null }) }] }])}
      />
      <SelectField label={t("labels.font")} value={overrides.typography?.fontId ?? document.labelStyle.fontId} options={BUNDLED_FONTS.map((font) => ({ value: font.fontId, label: font.family }))} onChange={(fontId) => {
        if (fontId !== "noto-sans" && fontId !== "noto-sans-sc") return;
        commitOverride(document, panelId, { typography: { ...(overrides.typography ?? {}), fontId } });
      }} />
      <SelectField label={t("labels.weight")} value={String(overrides.typography?.fontWeight ?? document.labelStyle.fontWeight)} options={[{ value: "400", label: t("labels.regular") }, { value: "700", label: t("labels.bold") }]} onChange={(w) => commitOverride(document, panelId, { typography: { fontWeight: w === "700" ? 700 : 400 } })} />
      <NumberField label={t("labels.size") + " (pt)"} value={overrides.typography?.fontSizePt ?? document.labelStyle.fontSizePt} min={0.1} onCommit={(fontSizePt) => commitOverride(document, panelId, { typography: { ...(overrides.typography ?? {}), fontSizePt } })} />
      <ColorField label={t("labels.color")} value={overrides.typography?.color ?? document.labelStyle.color} onCommit={(color) => commitOverride(document, panelId, { typography: { ...(overrides.typography ?? {}), color } })} />
      <SelectField label={t("labels.placement")} value={overrides.placement ?? document.labelStyle.placement} options={[{ value: "outside-top-left", label: t("labels.outside") }, { value: "inside-top-left", label: t("labels.inside") }]} onChange={(placement) => commitOverride(document, panelId, { placement: placement as "outside-top-left" | "inside-top-left" })} />
      <div className="field-pair" role="group" aria-labelledby="label-offset-reference">
        <NumberField label={t("labels.baselineX")} value={offset.x} onCommit={(x) => commitOverride(document, panelId, { offsetMm: { ...offset, x } })} />
        <NumberField label={t("labels.baselineY")} value={offset.y} onCommit={(y) => commitOverride(document, panelId, { offsetMm: { ...offset, y } })} />
      </div>
      <small className="muted" id="label-offset-reference">{t("labels.offsetReference")}</small>
      <Button action="hide-label" onClick={() => commitOverride(document, panelId, { visible: overrides.visible === false ? null : false })}>{t(overrides.visible === false ? "labels.show" : "labels.hide")}</Button>
      {overrides.text !== null && <Button action="reset-label-text" onClick={() => commitOverride(document, panelId, { text: null })}>{t("labels.resetText")}</Button>}
      {(overrides.offsetMm || overrides.placement) && <Button action="reset-label-position" onClick={() => commitOverride(document, panelId, { offsetMm: null, placement: null })}>{t("labels.resetPosition")}</Button>}
      {overrides.typography && Object.keys(overrides.typography).length > 0 && <Button action="reset-label-style" onClick={() => commitOverride(document, panelId, { typography: null })}>{t("labels.resetStyle")}</Button>}
      <details className="field-group"><summary>{t("labels.all")}</summary><LabelStyleFields style={document.labelStyle} /></details>
    </section>
  );
}

function MultiFields({ document, ids }: { document: FigureDocumentV1; ids: string[] }) {
  const { t } = useTranslation();
  const styles = ids.map(id => ({ ...document.labelStyle, ...document.panels[id]?.labelOverrides.typography }));
  function common<K extends "fontId" | "fontSizePt" | "fontWeight">(key: K): FigureDocumentV1["labelStyle"][K] | "mixed" {
    return styles.every(style => style[key] === styles[0]?.[key]) ? styles[0]?.[key] ?? document.labelStyle[key] : "mixed";
  }
  function setTypography(typography: NonNullable<LabelOverrides["typography"]>) {
    void transact([{ type: "label.setOverrides", items: ids.flatMap(panelId => {
      const panel = document.panels[panelId];
      return panel ? [{ panelId, value: mergedOverrides(panel.labelOverrides, { typography: { ...panel.labelOverrides.typography, ...typography } }) }] : [];
    }) }]);
  }
  const colors = ids.map((id) => document.panels[id]?.labelOverrides.typography?.color ?? document.labelStyle.color);
  const color = colors.every((item) => item === colors[0]) ? colors[0] ?? document.labelStyle.color : "mixed";
  const tooFew = ids.length < 2 ? t("inspector.needTwo") : undefined;
  const distributeReason = ids.length < 3 ? t("inspector.needThree") : undefined;
  return (
    <section className="section">
      <LocalRow key={ids.join()} document={document} ids={ids} />
      <h2>{t("inspector.align")}</h2>
      <div className="preset-row">
        {(["left", "right", "top", "bottom", "centerX", "centerY"] as const).map((edge) => (
          <Button key={edge} action={`align-${edge}`} disabledReason={tooFew} onClick={() => void align(edge, "selection")}>{t(`align.${edge}`)}</Button>
        ))}
      </div>
      <Button action="align-canvas" disabledReason={tooFew} onClick={() => void align("left", "canvas")}>{t("inspector.alignCanvas")}</Button>
      <h2>{t("inspector.distribute")}</h2>
      <Button action="distribute-h" disabledReason={distributeReason} onClick={() => void distribute("horizontal")}>{t("inspector.horizontal")}</Button>
      <Button action="distribute-v" disabledReason={distributeReason} onClick={() => void distribute("vertical")}>{t("inspector.vertical")}</Button>
      <Button action="equal-width" disabledReason={tooFew} onClick={() => void equalSize("width")}>{t("inspector.equalWidth")}</Button>
      <Button action="equal-height" disabledReason={tooFew} onClick={() => void equalSize("height")}>{t("inspector.equalHeight")}</Button>
      <h2>{t("inspector.common")}</h2>
      <SelectField label={t("labels.font")} value={common("fontId")} options={[{ value: "mixed", label: t("inspector.mixed") }, ...BUNDLED_FONTS.map(font => ({ value: font.fontId, label: font.family }))]}
        onChange={fontId => { if (fontId === "noto-sans" || fontId === "noto-sans-sc") setTypography({ fontId }); }} />
      <div className="field-pair"><NumberField label={t("labels.size") + " (pt)"} value={common("fontSizePt")} mixedLabel={t("inspector.mixed")} min={0.1} onCommit={fontSizePt => setTypography({ fontSizePt })} />
      <SelectField label={t("labels.weight")} value={String(common("fontWeight"))} options={[{ value: "mixed", label: t("inspector.mixed") }, { value: "400", label: t("labels.regular") }, { value: "700", label: t("labels.bold") }]}
        onChange={weight => { if (weight === "400" || weight === "700") setTypography({ fontWeight: weight === "700" ? 700 : 400 }); }} /></div>
      {color === "mixed" ? <p>{t("inspector.mixed")}</p> : null}
      <ColorField
        label={t("labels.color")}
        value={color === "mixed" ? "" : color}
        onCommit={(next) => {
          void transact([{
            type: "label.setOverrides",
            items: ids.flatMap((panelId) => {
              const panel = document.panels[panelId];
              if (!panel) return [];
              return [{ panelId, value: mergedOverrides(panel.labelOverrides, { typography: { ...(panel.labelOverrides.typography ?? {}), color: next } }) }];
            }),
          }]);
        }}
      />
      <Button action="group" disabledReason={tooFew} onClick={() => void createGroup()}>{t("inspector.group")}</Button>
    </section>
  );
}

function GroupFields({ document, groupId }: { document: FigureDocumentV1; groupId: string }) {
  const { t } = useTranslation();
  const group = document.groups[groupId];
  const revision = useWorkspace((state) => state.confirmed?.revision ?? 0);
  if (!group) return null;
  return (
    <section className="section" key={`${groupId}-${revision}`}>
      <h2>{group.name}</h2>
      <TextField label={t("panels.name")} value={group.name} onCommit={(name) => void transact([{ type: "group.rename", groupId, name }])} />
      <NumberField label="ΔX (mm)" value={0} onCommit={(dx) => void transact([translateSelection(document, group.panelIds, dx, 0)])} />
      <NumberField label="ΔY (mm)" value={0} onCommit={(dy) => void transact([translateSelection(document, group.panelIds, 0, dy)])} />
      <Button action="align-group" onClick={() => void align("left", "canvas")}>{t("inspector.alignCanvas")}</Button>
      <Button action="group-lock" onClick={() => void transact([{ type: "group.setLocked", groupId, locked: !group.locked }])}>
        {group.locked ? t("panels.unlock") : t("panels.lock")}
      </Button>
      <Button action="ungroup" onClick={() => void dissolveGroup(groupId)}>{t("inspector.ungroup")}</Button>
    </section>
  );
}

function CropFields() {
  const { t } = useTranslation();
  const crop = useWorkspace((state) => state.crop);
  if (!crop) return null;
  const invalid = cropInvalid(crop.crop);
  const print = (value: number) => value * 100;
  return (
    <section className="section crop-fields">
      <h2>{t("crop.title")}</h2>
      <fieldset>
        <legend>{t("crop.relative")}</legend>
        <div className="field-pair">
          <NumberField label={t("crop.horizontal")} value={print(crop.crop.x)} onCommit={(x) => updateCrop({ ...crop.crop, x: x / 100 })} />
          <NumberField label={t("crop.vertical")} value={print(crop.crop.y)} onCommit={(y) => updateCrop({ ...crop.crop, y: y / 100 })} />
        </div>
        <div className="field-pair">
          <NumberField label={t("inspector.width") + " (%)"} value={print(crop.crop.width)} onCommit={(width) => updateCrop({ ...crop.crop, width: width / 100 })} />
          <NumberField label={t("inspector.height") + " (%)"} value={print(crop.crop.height)} onCommit={(height) => updateCrop({ ...crop.crop, height: height / 100 })} />
        </div>
      </fieldset>
      {invalid && <p role="status">{t("crop.invalid")}</p>}
      <Button action="restore-crop" onClick={restoreFullCrop}>{t("crop.restore")}</Button>
      <CropActions />
    </section>
  );
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        placeholder={value === "" ? t("inspector.mixed") : undefined}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) event.currentTarget.blur(); }}
        onBlur={(event) => {
          const next = event.target.value.toUpperCase();
          if (!/^#[0-9A-F]{6}$/.test(next)) setText(value);
          else if (next !== value.toUpperCase()) onCommit(next);
        }}
      />
      <span className="swatches">
        {ARTWORK_COLOR_PRESETS.map((color) => (
          <button key={color} type="button" data-action={`color-${color}`} className="swatch" style={{ background: color }} aria-label={color} onClick={() => { if (color !== value.toUpperCase()) onCommit(color); }} />
        ))}
      </span>
    </label>
  );
}

function commitOverride(document: FigureDocumentV1, panelId: string, patchValue: Partial<LabelOverrides>): void {
  const panel = document.panels[panelId];
  if (!panel) return;
  void transact([{ type: "label.setOverrides", items: [{ panelId, value: mergedOverrides(panel.labelOverrides, patchValue) }] }]);
}
