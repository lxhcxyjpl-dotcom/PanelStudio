import { initializeLabelFonts } from "@panelstudio/core/labels";

let ready: Promise<void> | null = null;
export function ensureEditorFonts(): Promise<void> {
  return ready ??= initializeLabelFonts().catch((error: unknown) => { ready = null; throw error; });
}
