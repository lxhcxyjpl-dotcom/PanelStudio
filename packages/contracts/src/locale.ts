import Type, { type Static } from "typebox";
import { NonEmptyStringSchema } from "./primitives.js";
import { object } from "./schema.js";

export const LocalePackSchema = object(
  {
    schemaVersion: Type.Literal(1),
    locale: NonEmptyStringSchema,
    displayName: NonEmptyStringSchema,
    direction: Type.Literal("ltr"),
    messages: Type.Record(Type.String(), Type.String()),
  },
  {
    description:
      "Text only. HTML, scripts, and executable expressions are not part of a pack. Missing keys fall back to English.",
  },
);

/** Representative copy from handbook section 20.2. Not a complete UI catalog. */
export const REPRESENTATIVE_MESSAGES = {
  "zh-CN": {
    "toolbar.import": "导入图片",
    "toolbar.autoLayout": "一键排版",
    "layout.preview": "布局预览",
    "layout.apply": "使用此布局",
    "inspector.mixed": "混合",
    "ai.apply": "应用修改",
    "save.saved": "已保存",
    "save.failed": "保存失败，草稿已保留",
    "export.svg": "可编辑 SVG",
  },
  "en-US": {
    "toolbar.import": "Import images",
    "toolbar.autoLayout": "Auto layout",
    "layout.preview": "Layout preview",
    "layout.apply": "Use layout",
    "inspector.mixed": "Mixed",
    "ai.apply": "Apply changes",
    "save.saved": "Saved",
    "save.failed": "Save failed. Your draft is retained.",
    "export.svg": "Editable SVG",
  },
} as const;

export type LocalePack = Static<typeof LocalePackSchema>;
