import Type, { type Static } from "typebox";
import { NonEmptyStringSchema, ProjectTitleSchema, Sha256Schema } from "./primitives.js";
import { object } from "./schema.js";

export const ProjectManifestFileSchema = object({
  path: NonEmptyStringSchema,
  byteLength: Type.Integer({ minimum: 0 }),
  sha256: Sha256Schema,
  mediaType: NonEmptyStringSchema,
});

export const ProjectManifestSchema = object(
  {
    format: Type.Literal("panelstudio-project"),
    schemaVersion: Type.Literal(1),
    appVersion: NonEmptyStringSchema,
    title: ProjectTitleSchema,
    files: Type.Array(ProjectManifestFileSchema),
  },
  {
    description:
      "Project package manifest. The package does not carry history, secrets, model settings, logs, or AI transcripts.",
  },
);

export type ProjectManifest = Static<typeof ProjectManifestSchema>;
