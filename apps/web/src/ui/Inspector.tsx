import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { i18n } from "../i18n";
import {
  ARTWORK_COLOR_PRESETS,
  BUNDLED_FONTS,
  CANVAS_WIDTH_PRESETS_MM,
  type FigureDocumentV1,
  type LabelOverrides,
  type PromptPreset,
} from "@panelstudio/contracts";
import { scalePanel, translateSelection } from "@panelstudio/core/arrange";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { api } from "../api/client";
import { proposalChanges } from "../model/changes";
import { sidebarWidth } from "../model/chrome";
import { geometryLocked, mergedOverrides } from "../model/document-ui";
import {
  acceptCandidate,
  align,
  cancelAiPrompt,
  continueEditing,
  createGroup,
  dismissCandidates,
  dissolveGroup,
  distribute,
  enterCrop,
  equalSize,
  restoreFullCrop,
  sendAiPrompt,
  transact,
  updateCrop,
} from "../state/session";
import { patch, useWorkspace } from "../state/store";
import { baseDocument, candidatesStale } from "../state/types";
import { Button, NumberField, SelectField, TextField } from "./widgets";

const PROMPT_KEY = "panelstudio.presets";
const EXAMPLES = [
  "把六张图排成两行三列",
  "第一张放上面，其他图排在下面",
  "把 C 放左边作为主图",
  "Keep A on the left and arrange the others on the right",
  "面板间距改成 3 mm",
  "横向间距 2 mm，纵向间距 4 mm",
  "把 A 向右移动 2 mm",
  "B 的宽度设为 50 mm",
  "A 稍微大一点",
  "B 和 C 顶部对齐",
  "Make B and C the same height",
  "将选中的三张图水平等距分布",
  "A 保持不动",
  "解锁 B",
  "编号改成小写 a、b、c",
  "编号加括号",
  "编号统一 9 pt，加粗",
  "把 C 的编号改成 C1",
  "编号放在左上角外侧",
  "A 的编号向左移动 1 mm",
  "Labels should be black",
  "换成白底黑字",
  "整张图宽度设为 180 mm，再重新排一下",
  "撤销",
];

const BUILTIN_PRESETS = [
  { key: "preset.compact", prompt: "宽 180 mm，间距 3 mm，编号 9 pt。" },
  { key: "preset.hero", prompt: "把选中的图放在左边作为主图，其他图放在右边。" },
  { key: "preset.labels", prompt: "编号改成大写字母，加粗，黑色，放在左上角外侧。" },
] as const;

export function Inspector() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [tab, setTab] = useState<"properties" | "ai">("properties");
  const width = sidebarWidth("right", state.mode, state.rightWidth);
  const document = baseDocument(state);
  return (
    <aside
      className="sidebar right-sidebar"
      data-testid="right-sidebar"
      data-open={state.rightOpen ? "true" : "false"}
      style={{ width }}
      aria-label={t("a11y.right")}
    >
      <div className="tabs" role="tablist">
        <button type="button" data-action="tab-properties" role="tab" aria-selected={tab === "properties"} onClick={() => setTab("properties")}>
          {t("inspector.tab")}
        </button>
        <button type="button" data-action="tab-ai" role="tab" aria-selected={tab === "ai"} onClick={() => setTab("ai")}>
          {t("ai.tab")}
        </button>
      </div>
      <div className="side-scroll">
        {tab === "ai" ? <AiPanel /> : document ? <Properties document={document} /> : <p className="muted section">{t("app.noProject")}</p>}
      </div>
    </aside>
  );
}

function Properties({ document }: { document: FigureDocumentV1 }) {
  const state = useWorkspace();
  if (state.crop) return <CropFields document={document} />;
  if (state.selection.kind === "none") return <CanvasFields document={document} />;
  if (state.selection.kind === "label") return <LabelFields document={document} panelId={state.selection.panelId} />;
  if (state.selection.kind === "group") return <GroupFields document={document} groupId={state.selection.groupId} />;
  if (state.selection.kind === "panels" && state.selection.ids.length > 1) return <MultiFields document={document} ids={state.selection.ids} />;
  const panelId = state.selection.kind === "panels" ? state.selection.ids[0] : undefined;
  if (!panelId || !document.panels[panelId]) return <CanvasFields document={document} />;
  return <PanelFields document={document} panelId={panelId} />;
}

function CanvasFields({ document }: { document: FigureDocumentV1 }) {
  const { t } = useTranslation();
  const canvas = document.canvas;
  const settings = document.layoutSettings;
  const style = document.labelStyle;
  const ungrouped = document.panelOrder.filter((id) => !Object.values(document.groups).some((group) => group.panelIds.includes(id)));
  return (
    <>
      <section className="section">
        <h2>{t("inspector.canvas")}</h2>
        <div className="preset-row">
          {CANVAS_WIDTH_PRESETS_MM.map((width) => (
            <Button key={width} action={`width-${width}`} onClick={() => void transact([{ type: "canvas.set", canvas: { ...canvas, widthMm: width } }])}>
              {width}
            </Button>
          ))}
        </div>
        <NumberField label={t("inspector.width")} value={canvas.widthMm} min={0.1} onCommit={(widthMm) => void transact([{ type: "canvas.set", canvas: { ...canvas, widthMm } }])} />
        <NumberField label={t("inspector.height")} value={canvas.heightMm} min={0.1} onCommit={(heightMm) => void transact([{ type: "canvas.set", canvas: { ...canvas, heightMm } }])} />
        <SelectField
          label={t("inspector.heightMode")}
          value={canvas.heightMode}
          options={[{ value: "auto", label: t("inspector.auto") }, { value: "fixed", label: t("inspector.fixed") }]}
          onChange={(heightMode) => void transact([{ type: "canvas.set", canvas: { ...canvas, heightMode: heightMode === "fixed" ? "fixed" : "auto" } }])}
        />
        <NumberField label={t("inspector.top")} value={canvas.marginsMm.top} onCommit={(top) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, top } } }])} />
        <NumberField label={t("inspector.right")} value={canvas.marginsMm.right} onCommit={(right) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, right } } }])} />
        <NumberField label={t("inspector.bottom")} value={canvas.marginsMm.bottom} onCommit={(bottom) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, bottom } } }])} />
        <NumberField label={t("inspector.left")} value={canvas.marginsMm.left} onCommit={(left) => void transact([{ type: "canvas.set", canvas: { ...canvas, marginsMm: { ...canvas.marginsMm, left } } }])} />
        <label className="field">
          <span>{t("inspector.background")}</span>
          <input value={canvas.background} disabled title={t("inspector.backgroundLocked")} readOnly />
        </label>
      </section>
      <section className="section">
        <h2>{t("inspector.gutter")}</h2>
        <NumberField label={t("inspector.gutterX")} value={settings.gutterMm.horizontal} onCommit={(horizontal) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, gutterMm: { ...settings.gutterMm, horizontal } } }])} />
        <NumberField label={t("inspector.gutterY")} value={settings.gutterMm.vertical} onCommit={(vertical) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, gutterMm: { ...settings.gutterMm, vertical } } }])} />
        <SelectField
          label={t("inspector.primary")}
          value={settings.primaryPanelId ?? ""}
          options={[{ value: "", label: t("inspector.none") }, ...ungrouped.map((id) => ({ value: id, label: document.panels[id]?.name ?? id }))]}
          onChange={(value) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, primaryPanelId: value || null } }])}
        />
        <NumberField testId="min-width" label={t("inspector.minSize")} value={settings.minPanelSizeMm.width} min={0.1} onCommit={(width) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, minPanelSizeMm: { ...settings.minPanelSizeMm, width } } }])} />
        <NumberField label={t("inspector.preferredHeight")} value={settings.preferredHeightMm} min={0.1} onCommit={(preferredHeightMm) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, preferredHeightMm } }])} />
        <NumberField label={t("inspector.maxHeight")} value={settings.maxAutoHeightMm} min={0.1} onCommit={(maxAutoHeightMm) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, maxAutoHeightMm } }])} />
        <NumberField label={t("inspector.ppi")} value={settings.targetRasterPpi} min={1} onCommit={(targetRasterPpi) => void transact([{ type: "layout.setSettings", layoutSettings: { ...settings, targetRasterPpi } }])} />
      </section>
      <section className="section">
        <h2>{t("inspector.labels")}</h2>
        <LabelStyleFields style={style} />
      </section>
    </>
  );
}

function LabelStyleFields({ style }: { style: FigureDocumentV1["labelStyle"] }) {
  const { t } = useTranslation();
  return (
    <>
      <SelectField label={t("labels.sequence")} value={style.sequence} options={[{ value: "upper-alpha", label: t("labels.upper") }, { value: "lower-alpha", label: t("labels.lower") }, { value: "number", label: t("labels.number") }]} onChange={(sequence) => void transact([{ type: "label.setStyle", labelStyle: { ...style, sequence: sequence as FigureDocumentV1["labelStyle"]["sequence"] } }])} />
      <SelectField label={t("labels.format")} value={style.format} options={[{ value: "plain", label: t("labels.plain") }, { value: "parentheses", label: t("labels.parentheses") }, { value: "dot", label: t("labels.dot") }]} onChange={(format) => void transact([{ type: "label.setStyle", labelStyle: { ...style, format: format as FigureDocumentV1["labelStyle"]["format"] } }])} />
      <SelectField label={t("labels.font")} value={style.fontId} options={BUNDLED_FONTS.map((font) => ({ value: font.fontId, label: font.family }))} onChange={(fontId) => void transact([{ type: "label.setStyle", labelStyle: { ...style, fontId: fontId as FigureDocumentV1["labelStyle"]["fontId"] } }])} />
      <NumberField testId="label-size" label={t("labels.size")} value={style.fontSizePt} min={0.1} onCommit={(fontSizePt) => void transact([{ type: "label.setStyle", labelStyle: { ...style, fontSizePt } }])} />
      <SelectField label={t("labels.weight")} value={String(style.fontWeight)} options={[{ value: "400", label: t("labels.regular") }, { value: "700", label: t("labels.bold") }]} onChange={(fontWeight) => void transact([{ type: "label.setStyle", labelStyle: { ...style, fontWeight: fontWeight === "700" ? 700 : 400 } }])} />
      <ColorField label={t("labels.color")} value={style.color} onCommit={(color) => void transact([{ type: "label.setStyle", labelStyle: { ...style, color } }])} />
      <SelectField label={t("labels.placement")} value={style.placement} options={[{ value: "outside-top-left", label: t("labels.outside") }, { value: "inside-top-left", label: t("labels.inside") }]} onChange={(placement) => void transact([{ type: "label.setStyle", labelStyle: { ...style, placement: placement as FigureDocumentV1["labelStyle"]["placement"] } }])} />
      <NumberField label={t("labels.gap")} value={style.gapMm} onCommit={(gapMm) => void transact([{ type: "label.setStyle", labelStyle: { ...style, gapMm } }])} />
    </>
  );
}

function PanelFields({ document, panelId }: { document: FigureDocumentV1; panelId: string }) {
  const { t } = useTranslation();
  const panel = document.panels[panelId];
  if (!panel) return null;
  const blocked = geometryLocked(document, panelId);
  const reason = blocked === "group" ? t("inspector.disabledGroup") : blocked === "lock" ? t("inspector.disabledLock") : undefined;
  return (
    <section className="section">
      <h2>{panel.name}</h2>
      <TextField label={t("panels.name")} value={panel.name} onCommit={(name) => void transact([{ type: "panel.rename", panelId, name }])} />
      <NumberField label="X" value={panel.frameMm.x} disabledReason={reason} onCommit={(x) => void transact([translateSelection(document, [panelId], x - panel.frameMm.x, 0)])} />
      <NumberField label="Y" value={panel.frameMm.y} disabledReason={reason} onCommit={(y) => void transact([translateSelection(document, [panelId], 0, y - panel.frameMm.y)])} />
      <NumberField label={t("inspector.width")} value={panel.frameMm.width} min={0.1} disabledReason={reason} onCommit={(width) => void transact([scalePanel(document, panelId, { width }, "top-left")])} />
      <NumberField label={t("inspector.height")} value={panel.frameMm.height} min={0.1} disabledReason={reason} onCommit={(height) => void transact([scalePanel(document, panelId, { height }, "top-left")])} />
      <Button action="enter-crop" disabledReason={reason} onClick={() => enterCrop(panelId)}>{t("inspector.crop")}</Button>
      <Button action="panel-lock" onClick={() => void transact([{ type: "panel.setLocked", panelIds: [panelId], locked: !panel.locked }])}>
        {panel.locked ? t("panels.unlock") : t("panels.lock")}
      </Button>
      <Button action="select-its-label" onClick={() => patch({ selection: { kind: "label", panelId } })}>{t("panels.label")}</Button>
    </section>
  );
}

function LabelFields({ document, panelId }: { document: FigureDocumentV1; panelId: string }) {
  const { t } = useTranslation();
  const panel = document.panels[panelId];
  if (!panel) return null;
  const overrides = panel.labelOverrides;
  const resolved = resolvePanelLabel(document, panelId);
  return (
    <section className="section">
      <h2>{t("panels.label")}</h2>
      <TextField
        label={t("labels.content")}
        value={overrides.text ?? ""}
        onCommit={(text) => void transact([{ type: "label.setOverrides", items: [{ panelId, value: mergedOverrides(overrides, { text: text.trim() ? text : null }) }] }])}
      />
      <p className="muted">{t("labels.custom")}</p>
      <SelectField label={t("labels.format")} value={document.labelStyle.format} options={[{ value: "plain", label: t("labels.plain") }, { value: "parentheses", label: t("labels.parentheses") }, { value: "dot", label: t("labels.dot") }]} onChange={(format) => void transact([{ type: "label.setStyle", labelStyle: { ...document.labelStyle, format: format as FigureDocumentV1["labelStyle"]["format"] } }])} />
      <SelectField label={t("labels.font")} value={overrides.typography?.fontId ?? document.labelStyle.fontId} options={BUNDLED_FONTS.map((font) => ({ value: font.fontId, label: font.family }))} onChange={(fontId) => {
        if (fontId !== "noto-sans" && fontId !== "noto-sans-sc") return;
        commitOverride(document, panelId, { typography: { ...(overrides.typography ?? {}), fontId } });
      }} />
      <NumberField label={t("labels.size")} value={overrides.typography?.fontSizePt ?? document.labelStyle.fontSizePt} min={0.1} onCommit={(fontSizePt) => commitOverride(document, panelId, { typography: { ...(overrides.typography ?? {}), fontSizePt } })} />
      <ColorField label={t("labels.color")} value={overrides.typography?.color ?? document.labelStyle.color} onCommit={(color) => commitOverride(document, panelId, { typography: { ...(overrides.typography ?? {}), color } })} />
      <SelectField label={t("labels.placement")} value={overrides.placement ?? document.labelStyle.placement} options={[{ value: "outside-top-left", label: t("labels.outside") }, { value: "inside-top-left", label: t("labels.inside") }]} onChange={(placement) => commitOverride(document, panelId, { placement: placement as "outside-top-left" | "inside-top-left" })} />
      <NumberField label="dX" value={overrides.offsetMm?.x ?? 0} onCommit={(x) => commitOverride(document, panelId, { offsetMm: { x, y: overrides.offsetMm?.y ?? 0 } })} />
      <NumberField label="dY" value={overrides.offsetMm?.y ?? 0} onCommit={(y) => commitOverride(document, panelId, { offsetMm: { x: overrides.offsetMm?.x ?? 0, y } })} />
      <Button action="hide-label" onClick={() => commitOverride(document, panelId, { visible: false })}>{t("labels.hide")}</Button>
      {resolved ? <p className="muted">{resolved.text}</p> : <p className="muted">{t("labels.hide")}</p>}
    </section>
  );
}

function MultiFields({ document, ids }: { document: FigureDocumentV1; ids: string[] }) {
  const { t } = useTranslation();
  const colors = ids.map((id) => document.panels[id]?.labelOverrides.typography?.color ?? document.labelStyle.color);
  const color = colors.every((item) => item === colors[0]) ? colors[0] ?? document.labelStyle.color : "mixed";
  const tooFew = ids.length < 2 ? t("inspector.needTwo") : undefined;
  const distributeReason = ids.length < 3 ? t("inspector.needThree") : undefined;
  return (
    <section className="section">
      <h2>{t("inspector.align")}</h2>
      <div className="preset-row">
        {(["left", "right", "top", "bottom", "centerX", "centerY"] as const).map((edge) => (
          <Button key={edge} action={`align-${edge}`} disabledReason={tooFew} onClick={() => void align(edge, "selection")}>{edge}</Button>
        ))}
      </div>
      <Button action="align-canvas" disabledReason={tooFew} onClick={() => void align("left", "canvas")}>{t("inspector.alignCanvas")}</Button>
      <h2>{t("inspector.distribute")}</h2>
      <Button action="distribute-h" disabledReason={distributeReason} onClick={() => void distribute("horizontal")}>{t("inspector.horizontal")}</Button>
      <Button action="distribute-v" disabledReason={distributeReason} onClick={() => void distribute("vertical")}>{t("inspector.vertical")}</Button>
      <Button action="equal-width" disabledReason={tooFew} onClick={() => void equalSize("width")}>{t("inspector.equalWidth")}</Button>
      <Button action="equal-height" disabledReason={tooFew} onClick={() => void equalSize("height")}>{t("inspector.equalHeight")}</Button>
      <h2>{t("inspector.common")}</h2>
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
      <NumberField label="dX" value={0} onCommit={(dx) => void transact([translateSelection(document, group.panelIds, dx, 0)])} />
      <NumberField label="dY" value={0} onCommit={(dy) => void transact([translateSelection(document, group.panelIds, 0, dy)])} />
      <Button action="align-group" onClick={() => void align("left", "canvas")}>{t("inspector.alignCanvas")}</Button>
      <Button action="group-lock" onClick={() => void transact([{ type: "group.setLocked", groupId, locked: !group.locked }])}>
        {group.locked ? t("panels.unlock") : t("panels.lock")}
      </Button>
      <Button action="ungroup" onClick={() => void dissolveGroup(groupId)}>{t("inspector.ungroup")}</Button>
    </section>
  );
}

function CropFields({ document }: { document: FigureDocumentV1 }) {
  const { t } = useTranslation();
  const crop = useWorkspace((state) => state.crop);
  if (!crop) return null;
  const invalid = crop.crop.x < -1e-6 || crop.crop.y < -1e-6 || crop.crop.x + crop.crop.width > 1 + 1e-6 || crop.crop.y + crop.crop.height > 1 + 1e-6;
  return (
    <section className="section">
      <h2>{t("crop.title")}</h2>
      {invalid ? <p>{t("crop.invalid")}</p> : null}
      <NumberField label="X" value={crop.crop.x} onCommit={(x) => updateCrop({ ...crop.crop, x })} />
      <NumberField label="Y" value={crop.crop.y} onCommit={(y) => updateCrop({ ...crop.crop, y })} />
      <NumberField label={t("inspector.width")} value={crop.crop.width} min={0.01} onCommit={(width) => updateCrop({ ...crop.crop, width })} />
      <NumberField label={t("inspector.height")} value={crop.crop.height} min={0.01} onCommit={(height) => updateCrop({ ...crop.crop, height })} />
      <Button action="restore-crop" onClick={restoreFullCrop}>{t("crop.restore")}</Button>
      <p className="muted">{document.panels[crop.panelId]?.name}</p>
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
          if (/^#[0-9A-Fa-f]{6}$/.test(event.target.value)) onCommit(event.target.value.toUpperCase());
        }}
        onBlur={(event) => {
          if (/^#[0-9A-Fa-f]{6}$/.test(event.target.value)) onCommit(event.target.value.toUpperCase());
          else setText(value);
        }}
      />
      <span className="swatches">
        {ARTWORK_COLOR_PRESETS.map((color) => (
          <button key={color} type="button" data-action={`color-${color}`} className="swatch" style={{ background: color }} aria-label={color} onClick={() => onCommit(color)} />
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

function AiPanel() {
  const { t } = useTranslation();
  const state = useWorkspace();
  const document = baseDocument(state);
  const settings = useQuery({ queryKey: ["ai-provider"], queryFn: () => api.providerSettings() });
  const configured = Boolean(settings.data?.config && settings.data.hasSecret);
  const imageInput = Boolean(settings.data?.config?.capabilities.imageInput);
  const [prompt, setPrompt] = useState("");
  const [includePreview, setIncludePreview] = useState(false);
  const [visualReview, setVisualReview] = useState(false);
  const [presets, setPresets] = useState<PromptPreset[]>(() => readPresets());
  const scope = scopeText(document, state.selection);
  const card = state.cards.find((item) => item.candidate.origin === "ai" && item.candidate.id === (state.activeCandidateId ?? item.candidate.id));
  const aiCard = state.cards.find((item) => item.candidate.origin === "ai");
  const proposal = card ?? aiCard;
  const stale = Boolean(proposal) && candidatesStale(state);
  const running = state.aiStatus.phase === "running";
  const sendReason = !configured ? t("ai.notConfigured") : running ? t("ai.running") : prompt.trim() ? undefined : t("ai.prompt");
  function send() {
    if (sendReason) {
      patch({ liveMessage: sendReason });
      return;
    }
    void sendAiPrompt(prompt, { includePreviewImage: includePreview, visualReview });
  }
  const lines = proposal && document ? proposalChanges(document, proposal.candidate.previewDocument) : [];
  return (
    <section className="section" data-testid="ai-panel">
      <h2>{t("ai.tab")}</h2>
      <p>{scope}</p>
      {!configured ? <p data-testid="ai-status">{t("ai.notConfigured")}</p> : null}
      {configured && !imageInput ? <p>{t("ai.textOnly")}</p> : null}
      {state.aiStatus.phase === "running" ? <p data-testid="ai-status">{state.aiStatus.label}</p> : null}
      {state.aiStatus.phase === "failed" ? <p data-testid="ai-status">{state.aiStatus.message}</p> : null}
      {state.aiStatus.phase === "cancelled" ? <p data-testid="ai-status">{t("ai.cancelled")}</p> : null}
      {state.aiStatus.phase === "unsupported" ? <p data-testid="ai-status">{state.aiStatus.reason}</p> : null}
      {state.aiStatus.phase === "clarification" ? (
        <div data-testid="ai-status">
          <p>{state.aiStatus.question}</p>
          {state.aiStatus.options.map((option) => (
            <Button key={option} action="ai-option" onClick={() => setPrompt(option)}>{option}</Button>
          ))}
        </div>
      ) : null}
      {stale ? <p data-testid="ai-status">{t("ai.stale")}</p> : null}
      <label className="field">
        <span>{t("ai.prompt")}</span>
        <textarea
          data-testid="ai-prompt"
          rows={Math.min(8, Math.max(3, prompt.split("\n").length))}
          maxLength={4000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={includePreview} disabled={!imageInput} onChange={(event) => setIncludePreview(event.target.checked)} />
        {t("ai.previewImage")}
      </label>
      <label className="check">
        <input type="checkbox" checked={visualReview} disabled={!imageInput} onChange={(event) => setVisualReview(event.target.checked)} />
        {t("ai.review")}
      </label>
      <Button action="ai-send" disabledReason={sendReason} onClick={send}>{t("ai.send")}</Button>
      {running ? <Button action="ai-cancel" onClick={() => void cancelAiPrompt()}>{t("ai.cancel")}</Button> : null}
      {proposal ? (
        <div className="ai-preview" data-testid="ai-proposal">
          <p data-testid="ai-summary">{proposal.candidate.summary}</p>
          {lines.map((line, index) => (
            <p key={`${line.kind}-${index}`} data-testid="ai-change">{changeLine(t, line)}</p>
          ))}
          {proposal.previewUrl ? <img alt="" src={proposal.previewUrl} /> : null}
          <Button action="ai-apply" disabledReason={stale ? t("ai.stale") : undefined} onClick={() => void acceptCandidate()}>{t("ai.apply")}</Button>
          <Button action="ai-discard" onClick={dismissCandidates}>{t("ai.discard")}</Button>
          <Button action="ai-manual" onClick={continueEditing}>{t("layout.manual")}</Button>
        </div>
      ) : null}
      <h2>{t("ai.examples")}</h2>
      {EXAMPLES.map((example) => (
        <Button key={example} action="fill-example" onClick={() => setPrompt(example)}>{example}</Button>
      ))}
      {BUILTIN_PRESETS.map((preset) => (
        <Button key={preset.key} action="use-builtin" onClick={() => { setPrompt(preset.prompt); patch({ liveMessage: t("ai.saved") }); }}>
          {t(preset.key)}
        </Button>
      ))}
      <Button
        action="save-preset"
        disabledReason={prompt.trim() ? undefined : t("ai.prompt")}
        onClick={() => {
          const next = [...presets, { id: crypto.randomUUID(), title: prompt.slice(0, 24), prompt, scope: "all" as const }];
          setPresets(next);
          localStorage.setItem(PROMPT_KEY, JSON.stringify(next));
        }}
      >
        {t("ai.preset")}
      </Button>
      {presets.map((preset) => (
        <Button key={preset.id} action="use-preset" onClick={() => { setPrompt(preset.prompt); patch({ liveMessage: t("ai.saved") }); }}>
          {preset.title}
        </Button>
      ))}
    </section>
  );
}

function changeLine(t: ReturnType<typeof useTranslation>["t"], line: ReturnType<typeof proposalChanges>[number]): string {
  if (line.kind === "canvas") return t("ai.changeCanvas", line);
  if (line.kind === "gutter") return t("ai.changeGutter", line);
  if (line.kind === "labels") return t("ai.changeLabels");
  if (line.kind === "move") return t("ai.changeMove", line);
  if (line.kind === "size") return t("ai.changeSize", line);
  if (line.kind === "text") return t("ai.changeText", line);
  return t(line.locked ? "ai.changeLock" : "ai.changeUnlock", { label: line.label });
}

function scopeText(document: FigureDocumentV1 | null, selection: ReturnType<typeof useWorkspace.getState>["selection"]): string {
  if (!document) return i18n.t("ai.scopeAll", { count: 0 });
  if (selection.kind === "group") {
    const group = document.groups[selection.groupId];
    return i18n.t("ai.scopeGroup", { name: group?.name ?? "" });
  }
  if (selection.kind === "panels" && selection.ids.length > 0 && selection.ids.length < document.panelOrder.length) {
    const labels = selection.ids.map((id) => resolvePanelLabel(document, id)?.text ?? document.panels[id]?.name ?? id).join(", ");
    return i18n.t("ai.scopeSelection", { labels });
  }
  if (selection.kind === "label") return i18n.t("ai.scopeSelection", { labels: resolvePanelLabel(document, selection.panelId)?.text ?? "" });
  return i18n.t("ai.scopeAll", { count: document.panelOrder.length });
}

function readPresets(): PromptPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "[]") as PromptPreset[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.prompt === "string" && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}
