import Type, { type TObjectOptions, type TProperties, type TSchema } from "typebox";

/** Object schema that rejects unknown fields. */
export function object<Properties extends TProperties>(
  properties: Properties,
  options?: TObjectOptions,
) {
  return Type.Object(properties, {
    ...options,
    additionalProperties: false,
  });
}

export function nullable<Schema extends TSchema>(schema: Schema) {
  return Type.Union([schema, Type.Null()]);
}
