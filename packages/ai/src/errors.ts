import type { ErrorCode } from "@panelstudio/contracts";

export class AiCompileError extends Error {
  readonly code: ErrorCode;
  readonly details: {
    panelIds?: string[];
    assetIds?: string[];
    constraintIds?: string[];
  };

  constructor(
    code: ErrorCode,
    message: string,
    details: AiCompileError["details"] = {},
  ) {
    super(message);
    this.name = "AiCompileError";
    this.code = code;
    this.details = details;
  }
}

/** A provider call failed before a validated intent existed. The message is safe to store. */
export class AiTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiTransportError";
  }
}
