import type { TFunction } from "i18next";
import type { Asset, Diagnostic, FigureDocumentV1 } from "@panelstudio/contracts";
import { labelName } from "../model/changes";

/** Prefer the diagnostic message key. Fall back to the error code, then a generic sentence. */
export function formatDiagnostic(t: TFunction, item: Diagnostic): string {
  const codeText = t(`errors.${item.code}`, { ...item.params, defaultValue: t("errors.generic") });
  return t(item.messageKey, { ...item.params, defaultValue: codeText });
}

export function artworkFontNotices(document: FigureDocumentV1, assets: readonly Asset[]) {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const notices = new Map<string, { diagnostic: Diagnostic; panels: string[] }>();
  for (const id of document.panelOrder) {
    const panel = document.panels[id];
    const asset = panel && byId.get(panel.assetId);
    if (!asset) continue;
    for (const diagnostic of asset.diagnostics) {
      if (diagnostic.code !== "FONT_MISSING") continue;
      const key = JSON.stringify([diagnostic.messageKey, diagnostic.params]);
      const name = labelName(document, id) || asset.originalFilename;
      const notice = notices.get(key);
      if (notice) notice.panels.push(name);
      else notices.set(key, { diagnostic, panels: [name] });
    }
  }
  return [...notices.values()];
}
