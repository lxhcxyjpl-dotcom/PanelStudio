import type { TFunction } from "i18next";
import type { Diagnostic } from "@panelstudio/contracts";

/** Prefer the diagnostic message key. Fall back to the error code, then a generic sentence. */
export function formatDiagnostic(t: TFunction, item: Diagnostic): string {
  const codeText = t(`errors.${item.code}`, { ...item.params, defaultValue: t("errors.generic") });
  return t(item.messageKey, { ...item.params, defaultValue: codeText });
}
