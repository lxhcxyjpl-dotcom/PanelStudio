import { DocumentCommandError } from "@panelstudio/core/apply";
import { resolvePanelLabel } from "@panelstudio/core/labels";
import { ApiClientError } from "../api/client";
import { i18n } from "../i18n";
import { useWorkspace } from "../state/store";

export function errorText(error: unknown): string {
  if (!(error instanceof ApiClientError || error instanceof DocumentCommandError)) return i18n.t("errors.generic");
  const reason = error.details?.reason;
  const document = useWorkspace.getState().confirmed?.document;
  const names = document ? (error.details?.panelIds ?? []).flatMap((id) => {
    const name = resolvePanelLabel(document, id)?.text ?? document.panels[id]?.name;
    return name ? [name] : [];
  }) : [];
  const fallback = i18n.t(`errors.${error.code}`, { defaultValue: i18n.t("errors.generic") });
  const message = reason ? i18n.t(`reason.${reason}`, { defaultValue: fallback }) : fallback;
  return names.length ? `${message} (${names.join(", ")})` : message;
}
