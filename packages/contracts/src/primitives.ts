import Type, { type TSchema } from "typebox";
import { RESOURCE_LIMITS } from "./constants.js";
import { nullable, object } from "./schema.js";

export const UuidSchema = Type.String({
  format: "uuid",
  description: "UUID. Letters such as A, B, and C are labels, not object ids.",
});

export const RevisionSchema = Type.Integer({
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  description: "Non-negative safe integer. Revisions start at 0 and only increase.",
});

export const DateTimeSchema = Type.String({
  format: "date-time",
  description: "UTC ISO 8601 timestamp.",
});

export const Sha256Schema = Type.String({
  pattern: "^[a-f0-9]{64}$",
  description: "Lowercase hexadecimal SHA-256 digest.",
});

export const DocumentHashSchema = Type.String({
  minLength: 1,
  description:
    "Opaque document hash. The v0.1 handbook does not fix the algorithm.",
});

export const NonEmptyStringSchema = Type.String({ minLength: 1 });

export const HexColorSchema = Type.String({
  pattern: "^#[0-9A-Fa-f]{6}$",
  description: "Document color, #RRGGBB. Eight-digit hex is reserved for UI tokens.",
});

export const ProjectTitleSchema = Type.String({
  minLength: 1,
  maxLength: 120,
  description: "Project title, 1 to 120 characters.",
});

export const IdempotencyKeySchema = Type.String({
  minLength: 1,
  maxLength: 200,
  description: "Unique request id. Maximum length is a phase 0 encoding limit.",
});

export const PositiveMmSchema = Type.Number({
  exclusiveMinimum: 0,
  description: "Finite length in millimeters.",
});

export const NonNegativeMmSchema = Type.Number({
  minimum: 0,
  description: "Finite length in millimeters, zero allowed.",
});

export const PointMmSchema = object(
  {
    x: Type.Number({ description: "Millimeters." }),
    y: Type.Number({ description: "Millimeters." }),
  },
  { description: "Point in document millimeters." },
);

export const RectMmSchema = object(
  {
    x: Type.Number({ description: "Millimeters." }),
    y: Type.Number({ description: "Millimeters." }),
    width: PositiveMmSchema,
    height: PositiveMmSchema,
  },
  { description: "Rectangle in document millimeters." },
);

export const CropNormalizedSchema = object(
  {
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    width: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
    height: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  },
  {
    description:
      "Crop in 0–1 coordinates of the normalized asset. x + width and y + height must be <= 1. That cross-field bound is a document invariant and is not a JSON Schema keyword.",
  },
);

export const CustomLabelTextSchema = Type.String({
  minLength: 1,
  maxLength: RESOURCE_LIMITS.maxCustomLabelCharacters,
  pattern: "^[^\\r\\n]+$",
  description: "1 to 16 Unicode characters on a single line. Empty text cannot hide a label.",
});

export function uuidKeyed<Schema extends TSchema>(
  value: Schema,
  options?: { maxProperties?: number; description?: string },
) {
  return Type.Record(Type.String(), value, {
    propertyNames: UuidSchema,
    ...options,
  });
}

export const FontIdSchema = Type.Union([
  Type.Literal("noto-sans"),
  Type.Literal("noto-sans-sc"),
]);

export const FontWeightSchema = Type.Union([Type.Literal(400), Type.Literal(700)]);

export const ImportMediaTypeSchema = Type.Union([
  Type.Literal("image/png"),
  Type.Literal("image/jpeg"),
  Type.Literal("image/webp"),
  Type.Literal("image/svg+xml"),
]);

export const RenderMediaTypeSchema = Type.Union([
  Type.Literal("image/png"),
  Type.Literal("image/svg+xml"),
]);

export const ExportFormatSchema = Type.Union([
  Type.Literal("svg"),
  Type.Literal("png"),
  Type.Literal("project"),
]);

export const PngDpiSchema = Type.Union([
  Type.Literal(150),
  Type.Literal(300),
  Type.Literal(600),
]);
