# PanelStudio 组图学习实验

这个本地入口从论文的顶层面板学习结构，调用 PanelStudio 的真实排版引擎生成候选，也可以给一组独立素材排版。输入与输出均为本地文件。研究图稿、PDF 全文、逐篇图注、权重和盲选密钥放在自选工作目录。本仓库随实验提供算法、复现入口和[设计文档](../../docs/v0.3-layout-learning-design.md)。

## 首轮结果

基线为 PanelStudio v0.2 的 24bedc3。首轮核对了 46 篇来源中的 112 幅组图、452 个顶层面板。正式期刊 45 篇另加一篇预印本。正式论文按 29 / 7 / 9 篇分配给训练、验证、测试，预印本单列。以论文等权汇总，独立测试中 21 幅图的平均外框交并比为 v0.2 默认 0.411、最相近结构检索 0.362、同一候选池的几何排序 0.529、加入图型线索的排序 0.543。完整记录包含所有测试图、按论文配对的不确定区间及九组盲选。原 PDF 裁出的宽高比带有作者裁切信息，发表位置复原和作者审美需要分别测量。

## 在独立稿件上试用

从仓库根目录运行示例。下文用 Python 3 的实际解释器执行 python 命令。实验用到了 PyMuPDF、Pillow、NumPy、SciPy、scikit-learn 和 joblib。Node 使用仓库内的工作区依赖。首次试验产生的已训练工作目录为 .panelstudio/layout-learning-01。

~~~powershell
$work = ".panelstudio/layout-learning-01"
python experiments/layout-learning/demo.py "$work/example-input"
python experiments/layout-learning/suggest.py $work "$work/example-input/quant.json" "$work/example-quant"
python experiments/layout-learning/suggest.py $work "$work/example-input/design.json" "$work/example-design"
~~~

自行准备一份 UTF-8 JSON，按 A、B、C 等顺序列出 2–8 个可由 Pillow 读取的本地图片，文件路径相对 JSON 所在目录。已有字母和图内比例尺会包含在面板像素内。每份稿件选择一个空输出目录。以下例子把 A 和 B 作为等高的比较对象。

~~~json
{
  "brief": "先解释实验流程",
  "pair": ["A", "B"],
  "equalHeight": true,
  "panels": [
    {"file": "control.png", "caption": "第一组显微图"},
    {"file": "condition.png", "caption": "第二组显微图"},
    {"file": "comparison.png", "caption": "组间定量比较"},
    {"file": "design.png", "caption": "实验流程"}
  ]
}
~~~

brief、每幅子图的 caption、整图的 caption、pair、equalHeight 和 focus 都是可选项。填写 "focus": "C" 可直接指定主图。早期目标识别覆盖流程或实验设计、定量差异、显微形态三类关键词。判断使用独立面板的图型分数和说明，证据不足时保留并列。每个通过的方案输出一个预览和一个含独立面板对象的 SVG。图内文字的可编辑程度取决于素材形式，本入口把图片作为嵌入位图。正式版已有的矢量编辑与导出可经常规编辑器使用。

当作者明确要求“先解释”时，候选的主图须在第一阅读位置。等高要求委托现有引擎校验。推断时按实际版心利用率与温和的主图强调作额外排序，普通强调以主图面积约为其他面板均值的 1.6 倍作软偏好。这两项是产品启发式。若约束无解，输出 suggestion.json 记录原因。

## 从论文重跑

~~~powershell
$work = ".panelstudio/layout-learning-01"
python experiments/layout-learning/corpus.py <Zotero导出的RDF文件> $work --papers 51 --per-paper 3
python experiments/layout-learning/geometry.py $work "$work/review.tsv"
python experiments/layout-learning/content.py $work
node experiments/layout-learning/candidates.mjs $work
python experiments/layout-learning/rank.py $work
python experiments/layout-learning/curve.py $work
python experiments/layout-learning/blind.py $work
~~~

- corpus.py 在有单个 PDF 的书目里按期刊轮流抽样，用固定种子排列同刊论文。先定位图注，再从原页渲染完整候选图。用于评估的材料保留 PMID、DOI、图号、页码与来源区域。跨页和残缺候选需人工筛选。
- review.tsv 为制表符分隔的视觉审核记录。列为 id、layout、types、roi、reason。以 ABC/DE 表示第一行 A、B、C，第二行 D、E。A|40(B/60C) 表示 A 居左，右侧 B、C 上下排列，分隔位置按父区域百分比给出。下划线是确认为空的区域，roi 可指定整幅候选图的左、上、右、下百分比。类型按字母顺序记录 p 统计图、d 示意图、i 图像、b 条带、m 复合面板、t 表格或文字。排除行写 - 并记录原因。先核对原图，再核对生成的彩框。裁切和排版指标使用叶区可见像素的近似外框。
- content.py 按论文、DOI 和感知近重复聚类隔离数据。图型分类器使用固定分辨率的独立缩略图及颜色、纹理、边缘特征。排版训练行使用留出本论文簇的图型预测。图注只提取成对引用及明确的定量关系。单独的模型文件支持离线推断。
- candidates.mjs 生成真实 v0.2 自动候选、显式分行和最多各六个按宽高比或按内容检索的训练参考。循环内继续屏蔽同论文簇。已有文档校验器检查每个候选。两种学习排序使用同一候选池，便于比较增加内容特征的收益。
- rank.py 对发表外框 IoU 和方向相邻 F1 的加权分数设置弱正例，训练正则化线性排序器。每篇论文总权重相等，只在验证集选正则强度。训练集无足够近似候选的图计入覆盖失败。另报候选池最佳可达 IoU。curve.py 固定验证论文，在嵌套的 10、20、29 个训练论文簇上分别重训图型分类器、结构检索和排序器。
- blind.py 只展示独立测试中两种首选不同的图，左右位置平衡随机。图稿和题号直接嵌入 blind/index.html，静态预览可逐组向下浏览。用浏览器打开同一文件可放大、保存选择并导出 JSON。blind/组图盲选.pdf 每页呈现一组，沿用同样的题号、左右顺序和图稿比例。汇总使用 python experiments/layout-learning/blind.py 工作目录 --tally 反馈文件.json。程序检查问卷版本和作答身份，同一份重复导出仅使用一次。
- 要复查第一组盲选 SVG 在 Illustrator 的表现，可运行 verify-illustrator.ps1 -Ballot 工作目录/blind。脚本打开新建的样稿副本，检查画板、面板外框和独立移动，结果写入工作目录的 illustrator 子目录。

