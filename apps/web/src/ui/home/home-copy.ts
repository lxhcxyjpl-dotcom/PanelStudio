export const homeCopy = {
  "zh-CN": {
    title: "一组结果，\n不止一种表达。",
    start: "开始排版",
    layouts: ["主图聚焦", "成对对照", "纵向叙事"],
    gallery: "作品与演示",
    examples: "示例",
    projects: "项目",
    menu: "首页菜单",
    home: "返回首页",
    source: "合成示例 · 含 AI 显微示意",
    sourceTitle: "示例素材",
    sourceBody: "三种版式使用同一组素材。五张统计图使用合成数据，显微图由 AI 生成，仅作示意。",
    unavailable: "图稿加载失败",
  },
  "en-US": {
    title: "One set of results.\nMany ways to tell it.",
    start: "Start arranging",
    layouts: ["Focal panel", "Paired comparison", "Vertical narrative"],
    gallery: "Gallery and demo",
    examples: "Examples",
    projects: "Projects",
    menu: "Home menu",
    home: "Back to home",
    source: "Synthetic figures · AI microscopy illustration",
    sourceTitle: "About the artwork",
    sourceBody: "All three layouts use the same panels. The five plots use synthetic data. The microscopy illustration was generated with AI.",
    unavailable: "Artwork could not be loaded",
  },
} as const;

export function copyFor(language: string) {
  return language.startsWith("zh") ? homeCopy["zh-CN"] : homeCopy["en-US"];
}
