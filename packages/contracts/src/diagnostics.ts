import Type, { type Static } from "typebox";
import { NonEmptyStringSchema, UuidSchema } from "./primitives.js";
import { object } from "./schema.js";

export const DiagnosticParamsSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number()]),
  {
    description: "Interpolation values. Keys are message parameters, not a second error model.",
  },
);

export const DiagnosticSchema = object(
  {
    code: NonEmptyStringSchema,
    severity: Type.Union([
      Type.Literal("info"),
      Type.Literal("warning"),
      Type.Literal("error"),
    ]),
    messageKey: NonEmptyStringSchema,
    params: DiagnosticParamsSchema,
    panelIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
    assetIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
    constraintIds: Type.Optional(Type.Array(UuidSchema, { uniqueItems: true })),
  },
  {
    description:
      "Localized diagnostic. Known codes include the error catalog; FONT_MISSING is usually a warning.",
  },
);

export type Diagnostic = Static<typeof DiagnosticSchema>;
