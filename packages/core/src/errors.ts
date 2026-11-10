import type { ApiError } from "@panelstudio/contracts";

export class DocumentCommandError extends Error {
  readonly code: "DOCUMENT_INVALID" | "OUTSIDE_CANVAS" | "LOCKED_ELEMENT" | "GROUP_PARTIAL_EDIT" | "TEXT_METRICS_UNAVAILABLE" | "LAYOUT_CONFLICT";
  readonly details: ApiError["error"]["details"];

  constructor(
    code: DocumentCommandError["code"],
    message: string,
    details: DocumentCommandError["details"] = {},
  ) {
    super(message);
    this.name = "DocumentCommandError";
    this.code = code;
    this.details = details;
  }
}
