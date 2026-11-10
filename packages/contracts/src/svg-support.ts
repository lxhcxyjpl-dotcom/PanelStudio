/**
 * SVG support catalog. Wording follows handbook section 5.4.
 * Individual presentation attribute names are not enumerated there, so this
 * catalog does not freeze an attribute allow-list.
 */
export const SVG_SUPPORT = {
  catalogVersion: "1",
  unsupportedFeaturePolicy:
    "影响画面的不支持特性应明确报错，不能删除后继续显示一张残缺图。",
  preserve: {
    containers: ["svg", "g"],
    shapes: ["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"],
    text: ["text", "tspan"],
    attributeCategories: [
      "常见填充",
      "常见描边",
      "透明度",
      "虚线",
      "连接",
      "端点",
    ],
    clipPath: "经过样例验证的 clipPath",
    gradients: "基础线性、径向渐变",
    images: "嵌入的 PNG、JPEG",
    use: "可安全展开的内部 use",
    transforms: "源 SVG 内已有的基础变换矩阵",
  },
  reject: [
    "脚本、事件属性、动画",
    "foreignObject",
    "外部图片、外部 CSS、远程字体",
    "filter、复杂 mask、pattern",
    "未实现的 marker、textPath、vector-effect",
    "无法可靠展开的引用关系",
    "循环引用、异常深度和超出资源限制的内容",
  ],
  normalizationSteps: [
    "在不执行、不加载外部资源的环境中解析。",
    "对普通标准 SVG DOCTYPE，可在确认没有内部实体声明后安全剥离。",
    "禁用外部 DTD 和实体解析。",
    "拒绝内部实体、脚本、事件和外部引用。",
    "解析受支持 CSS，将样式固化为受支持的属性。",
    "保留组透明度等组合语义。",
    "处理根 viewBox 与 preserveAspectRatio。",
    "展开允许的内部引用。",
    "删除旧的 Adobe 私有编辑数据。",
    "生成规范化素材和诊断报告。",
  ],
  instanceIdRule:
    "同一个素材放入两次时，必须在实例化阶段用不同 panelId 为内部 ID 加前缀，并重写 url(#...) 与 href=\"#...\" 引用。不能修改共享素材缓存来实现前缀替换。",
} as const;
