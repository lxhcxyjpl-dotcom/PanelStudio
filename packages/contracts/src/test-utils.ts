import type { TSchema } from "typebox";
import { Check, Errors } from "typebox/value";

export const PANEL_ID = "11111111-1111-4111-8111-111111111111";
export const ASSET_ID = "22222222-2222-4222-8222-222222222222";
export const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

export function expectValid(schema: TSchema, value: unknown): void {
  if (Check(schema, value)) return;
  throw new Error(JSON.stringify(Errors(schema, value), null, 2));
}

export function expectInvalid(schema: TSchema, value: unknown): void {
  if (!Check(schema, value)) return;
  throw new Error("expected schema to reject the value");
}
