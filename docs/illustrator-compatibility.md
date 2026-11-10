# Illustrator 实机验收 · PanelStudio 0.2.0

2026-11-10 在 Windows 11 25H2（26200.9711，x64）上使用 Adobe Illustrator 2026 **30.7.0，build 114R**。五组 SVG 和 150 dpi 对照 PNG 均由本版应用从原始测试素材重新导出。检查脚本驱动本机 Illustrator 打开 SVG、访问和修改原生对象、另存为 `.ai`、关闭并重新打开。

**安装仓库随附的四个 Noto 静态字面并刷新 Illustrator 后，直接打开通过 152/156 项。** 中文混排样稿中有三个编号被 Illustrator 读为 `NotoSansSC-Medium`。三个单项字体检查和一项重开后的汇总检查因此失败。在同一台机器上，对应用导出的编号运行字体包里的还原脚本，随后按相同步骤复测，**156/156 项通过**。五组中仅三个编号需要还原。完整数据见[直接打开记录](acceptance-v0.2/direct-open.json)和[还原后记录](acceptance-v0.2/illustrator/report.json)。

| 样稿 | 检查材料 | 直接打开 | 使用还原工具 | 最终文件 |
| --- | --- | ---: | ---: | --- |
| 01 | 矢量曲线、可编辑文字、PNG、JPEG | 31/31 | 31/31 | [SVG](acceptance-v0.2/svg/01-mixed.svg) · [AI](acceptance-v0.2/illustrator/01-mixed.ai) |
| 02 | 裁剪后的 JPEG、矢量与栅格、常规字重 | 31/31 | 31/31 | [SVG](acceptance-v0.2/svg/02-cropped.svg) · [AI](acceptance-v0.2/illustrator/02-cropped.ai) |
| 03 | 中文“图甲”、希腊字符“(β)”、拉丁字符“III”，11 pt 粗体 | 27/31 | 31/31 | [SVG](acceptance-v0.2/svg/03-cjk.svg) · [AI](acceptance-v0.2/illustrator/03-cjk.ai) |
| 04 | 62% 组透明度、剪切蒙版、渐变、图像 | 32/32 | 32/32 | [SVG](acceptance-v0.2/svg/04-alpha.svg) · [AI](acceptance-v0.2/illustrator/04-alpha.ai) |
| 05 | 两次使用同一矢量素材、独立路径及文字、栅格热图 | 31/31 | 31/31 | [SVG](acceptance-v0.2/svg/05-repeated-vector.svg) · [AI](acceptance-v0.2/illustrator/05-repeated-vector.ai) |

## 测量和可编辑性

- 画板、剪切框、编号基线的验收阈值为 **0.1 mm**，编号字号为 **0.1 pt**。按报告保留的小数位，五组画板尺寸与预期一致。15 个编号的基线最大坐标差为 **0.0003 mm**，剪切框四个分量最大差约 **0.000045 mm**，字号最大差约 **0.000002 pt**。
- 每个图块单独选中并平移 1 mm，其他图块的编号基线保持原位。五份文件都能修改原生编号、修改导入的原生文字 `n=12` 和一条贝塞尔曲线的控制柄。保存并重开后，文字编辑、曲线编辑、图像数量、编号字号均保留。测试用 `.ai` 的首个编号已改成 `X`，导入的测试文字已改成 `n=13`。
- 五组均保留渐变，半透明样稿保留 62% 透明度。分别保存了[应用 PNG](acceptance-v0.2/svg/)与[Illustrator PNG](acceptance-v0.2/illustrator/)。按两图共同像素区域、白底 RGB 计算，每通道平均绝对差约为 0.142、0.394、0.413、0.418、0.183（0–255）。两组样稿在两个程序导出的像素画布尺寸相差 1 px。单位阈值通过原生对象测量。
- [实际精修演示导出的 SVG](../examples/refinement-six/refined.svg)另存为[可直接编辑的六图 AI](../examples/refinement-six/refined.ai)。文件保留演示的 A–F 编号。重开读回 6 个独立图块、1 个栅格对象、52 个路径对象。编号实际字体见[独立重开记录](acceptance-v0.2/example-reopen.json)。

## 怎样还原编号字重

1. 在 PanelStudio 的导出窗口下载内置字体包，安装 Noto Sans 和 Noto Sans SC 的 Regular 和 Bold。如果 Illustrator 正在运行，保存工作后重新打开它。
2. 用 Illustrator 打开 SVG。在“字符”面板检查编号的实际字体和字重。
3. 若出现替换，选择 **文件 → 脚本 → 其他脚本**，打开字体包内 `Illustrator/restore-label-fonts.jsx`。它与 `label-faces.jsxinc` 须放在同一目录。脚本读取导出 SVG 为每个编号指定的字面，只更改能唯一对应到 PanelStudio 编号的原生文字。实际缺少所需字面时会指出名称。然后另存为 `.ai`。[脚本源码](../scripts/illustrator/restore-label-fonts.jsx)

本机最初缺少编辑器使用的拉丁静态字面，Illustrator 曾替换为 `NotoSansJP-Regular/Bold`。把字体放在样稿旁的 `Document fonts` 目录没有消除替换。经过授权，四份已核对 SHA-256 的字面按当前用户额外登记，已有字体保留。重启后 Illustrator 能按 PostScript 名找到四个字面。直接打开中文样稿时，原 SVG 声明 `font-family="Noto Sans SC" font-weight="700"`，Illustrator 报告的字面仍为 Medium。还原后，三个编号在原生 `.ai` 重开时均为 `NotoSansSC-Bold`、11 pt。可对照[直接打开的 PNG](acceptance-v0.2/03-cjk-direct.png)与[还原后的 PNG](acceptance-v0.2/illustrator/03-cjk-illustrator.png)。

## 复现

从仓库根目录运行。每次检查使用一个新的输出目录。

```powershell
node scripts/illustrator/export-samples.mjs test-results/illustrator-input
.\scripts\illustrator\check.ps1 -Samples test-results/illustrator-input -Output test-results/illustrator-direct
.\scripts\illustrator\check.ps1 -Samples test-results/illustrator-input -Output test-results/illustrator-restored -RestoreLabelFonts
```

直接打开模式会为实测未通过的项目返回非零退出码。一次连续复核中，Illustrator 在后台保存后重开时退出，Windows 记录了 `c0000005`，具体原因未确定。验收脚本随后增加了 PDF 兼容 `.ai` 文件尾和文件大小的稳定性检查。重新运行的五个原生文件均完成保存、关闭和重开。此记录覆盖这台机器和上述 Illustrator 版本。此次未安排人员使用菜单和鼠标逐项人工签收。
