import type { Diagnostic } from "@panelstudio/contracts";

export class SvgImportError extends Error {
  readonly code = "SVG_UNSUPPORTED_FEATURE" as const;
  readonly diagnostics: Diagnostic[];

  constructor(feature: string) {
    super(feature);
    this.name = "SvgImportError";
    this.diagnostics = [
      {
        code: "SVG_UNSUPPORTED_FEATURE",
        severity: "error",
        messageKey: "svg.unsupportedFeature",
        params: { feature },
      },
    ];
  }
}
