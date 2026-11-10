import Type, { type Static } from "typebox";
import { RESOURCE_LIMITS } from "./constants.js";
import { NonEmptyStringSchema, UuidSchema } from "./primitives.js";
import { object } from "./schema.js";

export const PromptPresetSchema = object({
  id: UuidSchema,
  title: NonEmptyStringSchema,
  prompt: Type.String({
    minLength: 1,
    maxLength: RESOURCE_LIMITS.maxAiPromptCharacters,
  }),
  scope: Type.Union([Type.Literal("all"), Type.Literal("selection")]),
});

export type PromptPreset = Static<typeof PromptPresetSchema>;
