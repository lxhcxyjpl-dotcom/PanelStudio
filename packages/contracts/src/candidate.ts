import Type, { type Static } from "typebox";
import { DomainCommandSchema } from "./commands.js";
import { DiagnosticSchema } from "./diagnostics.js";
import { FigureDocumentSchema } from "./document.js";
import { DocumentHashSchema, NonEmptyStringSchema, RevisionSchema, UuidSchema } from "./primitives.js";
import { object } from "./schema.js";

/** Public candidate. score is stored separately and is not part of this object. */
export const CandidateSchema = object(
  {
    id: UuidSchema,
    projectId: UuidSchema,
    baseRevision: RevisionSchema,
    origin: Type.Union([Type.Literal("layout"), Type.Literal("ai")]),
    validationMode: Type.Union([Type.Literal("edit"), Type.Literal("layout")], {
      description: "Chosen by the server. The client cannot set it.",
    }),
    summary: NonEmptyStringSchema,
    commands: Type.Array(DomainCommandSchema),
    previewDocument: FigureDocumentSchema,
    resultDocumentHash: DocumentHashSchema,
    diagnostics: Type.Array(DiagnosticSchema),
    engineVersion: NonEmptyStringSchema,
    fontRegistryVersion: NonEmptyStringSchema,
  },
  {
    description:
      "previewDocument is derived from baseRevision plus commands. It is not a second stored document.",
  },
);

export type Candidate = Static<typeof CandidateSchema>;
