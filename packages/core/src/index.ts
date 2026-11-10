import { SCHEMA_VERSION } from "@panelstudio/contracts";

export const CORE_PHASE = 0 as const;

/** Binds this package to the shared schema version without defining a document model. */
export const boundSchemaVersion: typeof SCHEMA_VERSION = SCHEMA_VERSION;
