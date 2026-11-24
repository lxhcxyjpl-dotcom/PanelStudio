import Type, { type Static } from "typebox";
import { object } from "./schema.js";
import { ProjectTitleSchema, RevisionSchema, UuidSchema } from "./primitives.js";
import { RESOURCE_LIMITS } from "./constants.js";
import { ConfirmFigureIdentitySchema } from "./figure-reading.js";

export const MessageBranchRequestSchema = Type.Union([
  object({ kind: Type.Literal("figure"), title: ProjectTitleSchema, revision: RevisionSchema,
    assetIds: Type.Array(UuidSchema, { uniqueItems: true, maxItems: RESOURCE_LIMITS.maxAssetsPerProject }),
    identities: Type.Optional(Type.Array(object({ id: UuidSchema, ...ConfirmFigureIdentitySchema.properties }), { maxItems: RESOURCE_LIMITS.maxAssetsPerProject })) }),
  object({ kind: Type.Literal("ai"), title: ProjectTitleSchema, jobId: UuidSchema,
    prompt: Type.String({minLength:1,maxLength:RESOURCE_LIMITS.maxAiPromptCharacters}),
    replyLocale: Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]), includePreviewImage: Type.Boolean(), visualReview: Type.Boolean() }),
]);
export const MessageBranchResponseSchema = object({projectId:UuidSchema, jobId:Type.Union([UuidSchema,Type.Null()])});
export type MessageBranchRequest = Static<typeof MessageBranchRequestSchema>;
export type MessageBranchResponse = Static<typeof MessageBranchResponseSchema>;
