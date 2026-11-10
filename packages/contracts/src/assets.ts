import Type, { type Static } from "typebox";
import { DiagnosticSchema } from "./diagnostics.js";
import {
  DateTimeSchema,
  ImportMediaTypeSchema,
  NonEmptyStringSchema,
  RenderMediaTypeSchema,
  Sha256Schema,
  UuidSchema,
} from "./primitives.js";
import { nullable, object } from "./schema.js";

export const NormalizedAssetSchema = object({
  renderMediaType: RenderMediaTypeSchema,
  renderSha256: Sha256Schema,
  normalizationVersion: NonEmptyStringSchema,
  viewport: object({
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
  }),
  rasterPixelSize: nullable(
    object({
      width: Type.Integer({ exclusiveMinimum: 0 }),
      height: Type.Integer({ exclusiveMinimum: 0 }),
    }),
  ),
  fonts: Type.Array(
    object({
      family: NonEmptyStringSchema,
      availableForPreview: Type.Boolean(),
      fallbackFamily: nullable(NonEmptyStringSchema),
    }),
  ),
  normalizationNotes: Type.Array(Type.String()),
});

const assetFields = {
  id: UuidSchema,
  projectId: UuidSchema,
  createdAt: DateTimeSchema,
  originalFilename: NonEmptyStringSchema,
  originalMediaType: ImportMediaTypeSchema,
  originalByteLength: Type.Integer({ minimum: 0 }),
  originalSha256: Sha256Schema,
  importJobId: UuidSchema,
  diagnostics: Type.Array(DiagnosticSchema),
  removedFromLibraryAt: nullable(DateTimeSchema),
};

export const ProcessingAssetSchema = object({
  ...assetFields,
  status: Type.Literal("processing"),
  normalized: Type.Null(),
});

export const ReadyAssetSchema = object({
  ...assetFields,
  status: Type.Literal("ready"),
  normalized: NormalizedAssetSchema,
});

export const FailedAssetSchema = object({
  ...assetFields,
  status: Type.Literal("failed"),
  normalized: Type.Null(),
});

export const AssetSchema = Type.Union([
  ProcessingAssetSchema,
  ReadyAssetSchema,
  FailedAssetSchema,
]);

export const AssetAcceptedSchema = object({
  assetId: UuidSchema,
  jobId: UuidSchema,
});

export type NormalizedAsset = Static<typeof NormalizedAssetSchema>;
export type Asset = Static<typeof AssetSchema>;
