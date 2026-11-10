import { DEFAULT_RELATIVE_ENLARGE, type AIIntent } from "@panelstudio/contracts";
import type { FrozenScene } from "./scene.js";

/**
 * Recorded model outputs for the handbook section 20.3 corpus.
 * This is a test fixture. The server does not call it.
 */
export function fixtureIntent(prompt: string, scene: FrozenScene): AIIntent | null {
  const text = prompt.trim();
  const panel = (label: string) => scene.panels.find((item) => item.label === label);
  const id = (label: string) => panel(label)?.panelId;
  const proposal = (summary: string, actions: Extract<AIIntent, { kind: "proposal" }>["actions"]): AIIntent => ({
    version: 1,
    kind: "proposal",
    summary,
    actions,
  });
  if (text === "把六张图排成两行三列") {
    if (scene.panels.length < 6) {
      return { version: 1, kind: "clarification", question: "需要六张图才能排成两行三列。", options: ["使用现有面板自动排版"] };
    }
    const units = scene.panels.slice(0, 6).map((item) => `panel:${item.panelId}`);
    return proposal("将六张图排成两行三列。", [
      { type: "layout", request: { family: "rows", rows: [units.slice(0, 3), units.slice(3, 6)] } },
    ]);
  }
  if (text === "第一张放上面，其他图排在下面") {
    const primary = scene.panels[0]?.panelId;
    if (!primary) return { version: 1, kind: "clarification", question: "图中还没有面板。" };
    return proposal("将第一张图放在上方，其余图排在下方。", [
      { type: "layout", request: { family: "hero-top", primaryPanelId: primary } },
    ]);
  }
  if (text === "把 C 放左边作为主图") {
    const primary = id("C");
    if (!primary) return { version: 1, kind: "clarification", question: "没有找到编号为 C 的面板。" };
    return proposal("将 C 设为左侧主图，其余面板排在右侧。", [
      { type: "layout", request: { family: "hero-left", primaryPanelId: primary } },
    ]);
  }
  if (text === "Keep A on the left and arrange the others on the right") {
    const primary = id("A");
    if (!primary) return { version: 1, kind: "clarification", question: "Panel A was not found." };
    return proposal("Keep A on the left and arrange the others on the right.", [
      { type: "layout", request: { family: "hero-left", primaryPanelId: primary } },
    ]);
  }
  if (text === "面板间距改成 3 mm") {
    return proposal("面板间距调整为 3 mm，并重新排版。", [
      { type: "set_gutter", horizontalMm: 3, verticalMm: 3 },
      { type: "layout", request: { family: "auto" } },
    ]);
  }
  if (text === "横向间距 2 mm，纵向间距 4 mm") {
    return proposal("横向间距 2 mm，纵向间距 4 mm，并重新排版。", [
      { type: "set_gutter", horizontalMm: 2, verticalMm: 4 },
      { type: "layout", request: { family: "auto" } },
    ]);
  }
  if (text === "把 A 向右移动 2 mm") {
    const target = id("A");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 A 的面板。" };
    return proposal("将 A 向右移动 2 mm。", [{ type: "move_by_mm", targets: [{ kind: "panel", id: target }], dxMm: 2, dyMm: 0 }]);
  }
  if (text === "B 的宽度设为 50 mm") {
    const target = id("B");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 B 的面板。" };
    return proposal("将 B 的宽度设为 50 mm，高度按比例变化，左上角保持不动。", [
      { type: "scale_to_width", panelId: target, widthMm: 50 },
    ]);
  }
  if (text === "A 稍微大一点") {
    const target = panel("A");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 A 的面板。" };
    return proposal("将 A 的宽高放大 15%。", [
      { type: "scale_to_width", panelId: target.panelId, widthMm: target.widthMm * (1 + DEFAULT_RELATIVE_ENLARGE) },
    ]);
  }
  if (text === "B 和 C 顶部对齐") {
    const left = id("B");
    const right = id("C");
    if (!left || !right) return { version: 1, kind: "clarification", question: "没有找到 B 和 C。" };
    return proposal("将 B 和 C 的顶部对齐到 B。", [
      {
        type: "align",
        targets: [
          { kind: "panel", id: left },
          { kind: "panel", id: right },
        ],
        edge: "top",
        reference: { kind: "target", target: { kind: "panel", id: left } },
      },
    ]);
  }
  if (text === "Make B and C the same height") {
    const reference = panel("B");
    const target = panel("C");
    if (!reference || !target) return { version: 1, kind: "clarification", question: "Panels B and C were not found." };
    const widthMm = reference.heightMm * (target.widthMm / target.heightMm);
    return proposal("Make C the same height as B, which is the earlier label. The top-left corner stays put.", [
      { type: "scale_to_width", panelId: target.panelId, widthMm },
    ]);
  }
  if (text === "将选中的三张图水平等距分布") {
    if (scene.selectedPanelIds.length < 3) {
      return { version: 1, kind: "clarification", question: "请先选中三张图。", options: ["分布全部面板"] };
    }
    return proposal("将选中的三张图水平等距分布。", [
      {
        type: "distribute",
        targets: scene.selectedPanelIds.slice(0, 3).map((panelId) => ({ kind: "panel" as const, id: panelId })),
        axis: "horizontal",
      },
    ]);
  }
  if (text === "A 保持不动") {
    const target = id("A");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 A 的面板。" };
    return proposal("锁定 A 的几何。", [{ type: "set_lock", targets: [{ kind: "panel", id: target }], locked: true }]);
  }
  if (text === "解锁 B") {
    const target = id("B");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 B 的面板。" };
    return proposal("解锁 B。", [{ type: "set_lock", targets: [{ kind: "panel", id: target }], locked: false }]);
  }
  if (text === "编号改成小写 a、b、c") {
    return proposal("新增编号改为小写字母。", [{ type: "set_label_style", patch: { sequence: "lower-alpha" } }]);
  }
  if (text === "编号加括号") {
    return proposal("新增编号改为括号格式。", [{ type: "set_label_style", patch: { format: "parentheses" } }]);
  }
  if (text === "编号统一 9 pt，加粗") {
    return proposal("新增编号统一为 9 pt、粗体。这项只影响本工具新增的编号。", [
      { type: "set_label_style", patch: { fontSizePt: 9, fontWeight: 700 } },
    ]);
  }
  if (text === "把 C 的编号改成 C1") {
    const target = id("C");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 C 的面板。" };
    return proposal("将 C 的编号改为 C1。", [{ type: "set_panel_label", panelId: target, patch: { text: "C1" } }]);
  }
  if (text === "编号放在左上角外侧") {
    return proposal("新增编号放在左上角外侧。", [{ type: "set_label_style", patch: { placement: "outside-top-left" } }]);
  }
  if (text === "A 的编号向左移动 1 mm") {
    const target = id("A");
    if (!target) return { version: 1, kind: "clarification", question: "没有找到编号为 A 的面板。" };
    return proposal("将 A 的编号基线向左移动 1 mm。", [
      { type: "set_panel_label", panelId: target, patch: { offsetMm: { x: -1, y: -scene.labelStyle.gapMm } } },
    ]);
  }
  if (text === "Labels should be black") {
    return proposal("Set the new labels to black. Uploaded image colors stay unchanged.", [
      { type: "set_label_style", patch: { color: "#000000" } },
    ]);
  }
  if (text === "换成白底黑字") {
    return proposal("画板保持白色，新增编号改为黑色。上传图片内部的颜色不变。", [
      { type: "set_label_style", patch: { color: "#000000" } },
    ]);
  }
  if (text === "整张图宽度设为 180 mm，再重新排一下") {
    return proposal("将画板宽度设为 180 mm，并重新排版。", [
      { type: "set_canvas", widthMm: 180 },
      { type: "layout", request: { family: "auto" } },
    ]);
  }
  if (text === "撤销" || text.toLowerCase() === "undo") {
    return { version: 1, kind: "unsupported", reason: "撤销直接使用历史栈，不调用模型。" };
  }
  return null;
}

export const CORPUS_PROMPTS = [
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
] as const;
