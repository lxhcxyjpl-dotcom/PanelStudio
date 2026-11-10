export class DocumentCommandError extends Error {
  readonly code: "DOCUMENT_INVALID" | "OUTSIDE_CANVAS" | "LOCKED_ELEMENT" | "GROUP_PARTIAL_EDIT";
  readonly details: {
    panelIds?: string[];
    assetIds?: string[];
    constraintIds?: string[];
  };

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
